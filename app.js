const firebaseConfig = {
    apiKey: "AIzaSyA1sUfsUCsfqFYBAG7xEVhwP0Y64d5TA_8",
    authDomain: "worship-bkc.firebaseapp.com",
    projectId: "worship-bkc",
    storageBucket: "worship-bkc.firebasestorage.app",
    messagingSenderId: "585802631589",
    appId: "1:585802631589:web:ebeaa5f89cac319309404c",
    measurementId: "G-NRX7KRF6TY"
};
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch((err) => {});

const db = firebase.firestore();
const auth = firebase.auth();
const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/jgc1rmgz/image/upload";
const CLOUDINARY_UPLOAD_PRESET = "unsigned_preset"; 

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error) => {});

let currentUser = null;
let isEditor = false;
let isAdmin = false;
let songsList = [];          
let customAlbums = ['ទំនុកដំកើង', 'ទំនុកខ្មែរបរិសុទ្ធ'];
let playlists = JSON.parse(localStorage.getItem('user_playlists') || '{}');
let globalSetlists = {};
let hasCheckedMonthlySetlists = false;

function listenToGlobalSetlists() {
    db.collection("public_settings").doc("setlists").onSnapshot((doc) => {
        if (doc.exists) {
            globalSetlists = doc.data();
        } else {
            globalSetlists = {};
        }
        
        if (isEditor && !hasCheckedMonthlySetlists) {
            hasCheckedMonthlySetlists = true;
            checkAndResetMonthlySetlists();
        }
        
        const viewHome = document.getElementById('viewHome');
        if (viewHome && viewHome.classList.contains('active')) {
            renderHomeView();
        }
        
        if (currentFilterType === 'SETLIST') {
            renderSongs();
        }
    }, (error) => {
        console.error("Firebase Setlist Error:", error);
        if(isEditor) showToast("បញ្ហា Firebase Rules: " + error.message, "error");
    });
}

let currentFilterType = 'ALL';      
let currentFilterValue = 'ALL';     

let selectedImageBase64 = '';
let selectedEditImageBase64 = '';
let batchImagesArray = [];
let currentFilteredSongs = [];
let currentFullscreenIndex = 0;

let displayedItemCount = 20;
const CHUNK_SIZE = 20;
let isLoadingMore = false;
let isDataLoaded = false;
let deferredPrompt = null;
let songsListenerUnsubscribe = null;
let scrollObserver = null;

let dragSrcId = null;
let wakeLock = null;

let isAutoScrolling = false;
let autoScrollSpeed = 0.5;
let autoScrollFrameReq = null;

let tapCount = 0;
let tapTimeout = null;

let currentTransposeStep = 0;
let baseSongKey = "C";
const keysSharp = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const keysFlat  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

async function syncPlaylistsToCloud() {
    if (currentUser) {
        try {
            await db.collection("users").doc(currentUser.uid).set({ playlists: playlists }, { merge: true });
        } catch (err) { console.error("Cloud Sync Error", err); }
    }
}

async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } 
    catch (err) { console.log('Wake Lock Error:', err); }
}

function releaseWakeLock() {
    if (wakeLock !== null) { wakeLock.release(); wakeLock = null; }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => {}));
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installPwaBtn');
    if (installBtn) installBtn.style.display = 'flex';
});

function installPwaApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
            deferredPrompt = null;
            document.getElementById('installPwaBtn').style.display = 'none';
        });
    }
}

function checkAndShowIosInstallGuide() {
    const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isStandalone = ('standalone' in window.navigator) && (window.navigator.standalone);
    if (isIos && !isStandalone) {
        const installBtn = document.getElementById('installPwaBtn');
        installBtn.style.display = 'flex';
        installBtn.onclick = function() {
            alert("នៅលើ iPhone៖ សូមចុចប៊ូតុង Share នៅផ្នែកខាងក្រោម រួចរំកិលចុះក្រោម រួចជ្រើសរើស 'Add to Home Screen' ដើម្បីដំឡើង App នេះ។");
        };
    }
}

function vibratePhone(ms = 50) {
    if (navigator.vibrate) { navigator.vibrate(ms); }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-xmark';
    if (type === 'warning') icon = 'fa-triangle-exclamation';
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function startVoiceSearch() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { 
        showToast('Browser របស់អ្នកមិនគាំទ្រមុខងារស្វែងរកដោយសំឡេងទេ', 'warning'); 
        return; 
    }
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'km-KH'; 
    recognition.interimResults = false;
    
    recognition.onstart = function() { 
        document.getElementById('voiceSearchBtn').style.color = 'var(--danger)'; 
        showToast('កំពុងស្តាប់...', 'info'); 
    };
    
    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        document.getElementById('searchInput').value = transcript;
        handleSearchInput();
    };
    
    recognition.onend = function() { 
        document.getElementById('voiceSearchBtn').style.color = 'var(--primary)'; 
    };
    
    recognition.onerror = function(event) {
        let errorMsg = 'មិនអាចស្តាប់បានច្បាស់ សូមព្យាយាមម្តងទៀត';
        if (event.error === 'not-allowed') { errorMsg = 'សូមបើកសិទ្ធិ (Allow) ឲ្យកម្មវិធីប្រើប្រាស់ Microphone សិន'; } 
        else if (event.error === 'network') { errorMsg = 'សូមភ្ជាប់អ៊ីនធឺណិតដើម្បីប្រើប្រាស់មុខងារសំឡេង'; } 
        else if (event.error === 'no-speech') { errorMsg = 'មិនមានសំឡេងចូលទេ'; }
        showToast(errorMsg, 'warning');
        document.getElementById('voiceSearchBtn').style.color = 'var(--primary)';
    }
    recognition.start();
}

let dbIndexed = null;
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('SongAppOfflineDB', 1);
        request.onerror = (e) => reject(e);
        request.onsuccess = (e) => { dbIndexed = e.target.result; resolve(dbIndexed); };
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('offlineSongs')) database.createObjectStore('offlineSongs', { keyPath: 'id' });
        };
    });
}

function toggleFilterUI(isFiltered) {
    const filterChips = document.querySelector('.filter-chips');
    const backBtn = document.getElementById('backButton');
    const iconCircle = document.querySelector('.section-title .icon-circle');

    if (isFiltered) {
        if (filterChips) filterChips.style.display = 'none';
        if (iconCircle) iconCircle.style.display = 'none';
        if (backBtn) backBtn.style.display = 'block';
    } else {
        if (filterChips) filterChips.style.display = 'flex';
        if (iconCircle) iconCircle.style.display = 'flex';
        if (backBtn) backBtn.style.display = 'none';
    }
}

function goBackToMain() {
    const prevFilterType = currentFilterType;
    const prevFilterValue = currentFilterValue; 
    
    resetFilters();
    
    if (prevFilterType === 'ALBUM') {
        switchTab('albums'); 
    } else if (prevFilterType === 'PLAYLIST') {
        if (prevFilterValue === 'Favorite') {
            switchTab('home'); 
        } else {
            switchTab('playlists'); 
        }
    } else if (prevFilterType === 'SETLIST' || prevFilterType === 'RECENT' || prevFilterType === 'HISTORY') {
        switchTab('home'); 
    } else {
        switchTab('songs'); 
    }
}

window.onload = async function() {
    setTimeout(() => {
        const splash = document.getElementById('splashScreen');
        if (splash) splash.classList.add('hide');
    }, 1200);

    window.oncontextmenu = function(event) {
        if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
            event.preventDefault(); 
            event.stopPropagation();
            return false;
        }
    };

    applyStoredTheme();
    applyStoredViewMode();
    applySettingsToggles(); 
    listenToAuth();
    listenToAlbums();
    listenToGlobalSetlists();
    renderSongsListOnly();
    checkAndShowIosInstallGuide();
    updateOnlineStatus();
    checkNewSongsNotification();

    const tapArea = document.getElementById('versionTapArea');
    if (tapArea) {
        tapArea.addEventListener('click', function() {
            tapCount++;
            if (tapTimeout) clearTimeout(tapTimeout);
            
            if (tapCount >= 3) {
                if (isEditor) {
                    const adminPanel = document.getElementById('secretAdminPanel');
                    if (adminPanel.style.display === 'none') {
                        adminPanel.style.display = 'block';
                        showToast('មុខងារ Admin បានបើក', 'success');
                        vibratePhone(100);
                    } else {
                        adminPanel.style.display = 'none';
                        showToast('មុខងារ Admin ត្រូវបានលាក់', 'info');
                    }
                } else {
                    showToast('អ្នកគ្មានសិទ្ធិជា Admin ទេ', 'error');
                }
                tapCount = 0;
            } else {
                tapTimeout = setTimeout(() => { tapCount = 0; }, 600);
            }
        });
    }

    try {
        await initIndexedDB();
        const offlineSongs = await loadSongsFromIndexedDB();
        if (offlineSongs && offlineSongs.length > 0) {
            songsList = offlineSongs;
            isDataLoaded = true;
            renderSongs();
            renderHomeView();
            updateTotalSongCount();
            markFetchCompleted();
            checkNewSongsNotification();
        } else {
            fetchAllSongsSilently();
        }
    } catch (e) {
        fetchAllSongsSilently();
    }

    listenToSongsChanges();
    initPinchToZoom();
    setupIntersectionObserver();
    setupDropZoneHandlers();

    document.addEventListener('click', function(e) {
        const searchBox = document.querySelector('.search-box');
        if (searchBox && !searchBox.contains(e.target)) hideSearchDropdown();

        if (!e.target.closest('.card-dropdown') && !e.target.closest('.btn-more-options')) {
            document.querySelectorAll('.card-dropdown').forEach(el => el.classList.remove('show'));
        }
        
        const profilePopup = document.getElementById('profilePopup');
        const profileBtn = document.getElementById('homeProfileBtn');
        if (profilePopup && profileBtn && !profilePopup.contains(e.target) && !profileBtn.contains(e.target)) {
            profilePopup.classList.remove('show');
            profileBtn.classList.remove('active');
        }
    });
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if(e.target === modal) closeModal(modal.id);
        });
    });
};

function setupDropZoneHandlers() {
    setupSingleDropZone('dropZone', 'previewImg', 'previewContainer', (b64) => selectedImageBase64 = b64);
    setupSingleDropZone('editDropZone', 'editPreviewImg', 'editPreviewContainer', (b64) => selectedEditImageBase64 = b64);
}

function setupSingleDropZone(zoneId, imgElemId, containerId, callback) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;

    zone.addEventListener('paste', (e) => {
        e.stopPropagation();
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                processAndCompressFile(file, imgElemId, containerId, callback);
                break;
            }
        }
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => zone.addEventListener(eventName, () => zone.classList.add('dragover'), false));
    ['dragleave', 'drop'].forEach(eventName => zone.addEventListener(eventName, () => zone.classList.remove('dragover'), false));

    zone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0 && files[0].type.startsWith('image/')) processAndCompressFile(files[0], imgElemId, containerId, callback);
    });
}

function updateTotalSongCount() {
    const countEl = document.getElementById('totalSongCountBadge');
    if (countEl && songsList) countEl.innerText = `${songsList.length} បទ`;
}

function setQuickFilter(type, btnElement) {
    document.querySelectorAll('.chip-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    if (type === 'ALL') resetFilters();
    else if (type === 'RECENT') {
        document.getElementById('sectionTitleText').innerText = "បទថ្មីៗ";
        document.getElementById('currentAlbumSubtitle').innerHTML = `Khmer Christian Worship Songs`;
        currentFilterType = 'RECENT'; currentFilterValue = 'RECENT';
        toggleFilterUI(false); 
        renderSongs();
    } else if (type === 'FAV') {
        filterByPlaylist('Favorite');
    } else if (type === 'HISTORY') { 
        document.getElementById('sectionTitleText').innerText = "ប្រវត្តិអាន (ទើបតែបើក)";
        document.getElementById('currentAlbumSubtitle').innerHTML = `Khmer Christian Worship Songs`;
        currentFilterType = 'HISTORY'; currentFilterValue = 'HISTORY';
        toggleFilterUI(false); 
        renderSongs();
    } 
}

function listenToSongsChanges() {
    if (songsListenerUnsubscribe) songsListenerUnsubscribe();

    songsListenerUnsubscribe = db.collection("songs").onSnapshot((snapshot) => {
        let hasNewChanges = false;
        snapshot.docChanges().forEach((change) => {
            const doc = change.doc;
            const data = doc.data();
            const songItem = { id: doc.id, ...data, createdAt: data.createdAt ? { seconds: data.createdAt.seconds } : null, updatedAt: data.updatedAt ? { seconds: data.updatedAt.seconds } : null };

            if (change.type === "added" && !songsList.some(s => s.id === doc.id)) { songsList.unshift(songItem); hasNewChanges = true; } 
            else if (change.type === "modified") { const idx = songsList.findIndex(s => s.id === doc.id); if (idx !== -1) { songsList[idx] = songItem; hasNewChanges = true; } } 
            else if (change.type === "removed") { const idx = songsList.findIndex(s => s.id === doc.id); if (idx !== -1) { songsList.splice(idx, 1); hasNewChanges = true; } }
        });

        if (hasNewChanges) {
            songsList.sort((a, b) => {
                const timeA = a.createdAt ? a.createdAt.seconds : 0;
                const timeB = b.createdAt ? b.createdAt.seconds : 0;
                return timeB - timeA;
            });
            isDataLoaded = true;
            renderSongs();
            renderHomeView();
            updateTotalSongCount();
            saveSongsToIndexedDB(songsList);
            checkNewSongsNotification();
        }
    }, (error) => {});
}

function switchTab(tabName) {
    document.querySelectorAll('.app-view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));

    const mainHeader = document.getElementById('mainAppHeader');
    const isFiltered = (currentFilterType === 'ALBUM' || currentFilterType === 'PLAYLIST' || currentFilterType === 'SETLIST');

    if (tabName !== 'tuner' && typeof isTunerActive !== 'undefined' && isTunerActive) {
        toggleTunerAction(); 
    }

    if (tabName === 'home') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewHome').classList.add('active');
        const navBtn = document.getElementById('navHomeBtn');
        if (navBtn) navBtn.classList.add('active');
        renderHomeView();
    } else if (tabName === 'songs') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewSongs').classList.add('active');
        const navBtn = document.getElementById('navSongsBtn');
        if (navBtn) navBtn.classList.add('active');
        renderSongs();
    } else if (tabName === 'albums') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewAlbums').classList.add('active');
        const navBtn = document.getElementById('navAlbumsBtn');
        if (navBtn) navBtn.classList.add('active');
        renderAlbumsView();
    } else if (tabName === 'playlists') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewPlaylists').classList.add('active');
        renderPlaylistsView();
    } else if (tabName === 'settings') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewSettings').classList.add('active');
        const navBtn = document.getElementById('navProfileBtn');
        if (navBtn) navBtn.classList.add('active');
        closeNotificationsSubView();
        renderSettingsView();
    } else if (tabName === 'tuner') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewTuner').classList.add('active');
    }
}

function openNotificationsSubView() {
    document.getElementById('mainSettingsContainer').style.display = 'none';
    document.getElementById('subViewNotifications').classList.add('active');
    markNotificationsAsRead();
}

function closeNotificationsSubView() {
    document.getElementById('mainSettingsContainer').style.display = 'block';
    document.getElementById('subViewNotifications').classList.remove('active');
}

function checkNewSongsNotification() {
    if (!songsList || songsList.length === 0) return;
    const lastChecked = localStorage.getItem('last_seen_song_time') || 0;
    
    const newSongs = songsList.filter(s => s.createdAt && s.createdAt.seconds > lastChecked);
    
    const dot = document.getElementById('navNotifDot');
    const badge = document.getElementById('settingsNotifBadge');
    if (newSongs.length > 0) {
        if(dot) dot.style.display = 'block';
        if(badge) {
            badge.innerText = `${newSongs.length} ថ្មី`;
            badge.style.display = 'inline-block';
        }
    } else {
        if(dot) dot.style.display = 'none';
        if(badge) badge.style.display = 'none';
    }
}

function markNotificationsAsRead() {
    if (songsList && songsList.length > 0 && songsList[0].createdAt) {
        localStorage.setItem('last_seen_song_time', songsList[0].createdAt.seconds);
        const dot = document.getElementById('navNotifDot');
        if(dot) dot.style.display = 'none';
        const badge = document.getElementById('settingsNotifBadge');
        if(badge) badge.style.display = 'none';
    }
}

function setupIntersectionObserver() {
    const options = { root: null, rootMargin: '200px', threshold: 0.1 };
    scrollObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && isDataLoaded) {
            loadMoreChunks();
        }
    }, options);
}

function observeSentinel() {
    const sentinel = document.getElementById('scrollSentinel');
    if (sentinel && scrollObserver) {
        scrollObserver.disconnect();
        scrollObserver.observe(sentinel);
    }
}

function getSkeletonHTML(count = 6) {
    return Array(count).fill(`
        <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-info">
                <div class="skeleton-line"></div>
                <div class="skeleton-line short"></div>
                <div class="skeleton-btns">
                    <div class="skeleton-btn"></div>
                    <div class="skeleton-btn"></div>
                </div>
            </div>
        </div>
    `).join('');
}

function loadMoreChunks() {
    if (displayedItemCount >= currentFilteredSongs.length) return;
    isLoadingMore = true;

    const grid = document.getElementById('songGrid');
    
    const skeletonContainer = document.createElement('div');
    skeletonContainer.id = 'loadingSpinner';
    skeletonContainer.style.display = 'contents';
    skeletonContainer.innerHTML = getSkeletonHTML(4);
    
    const sentinel = document.getElementById('scrollSentinel');
    if(sentinel) grid.insertBefore(skeletonContainer, sentinel);
    else grid.appendChild(skeletonContainer);

    setTimeout(() => {
        displayedItemCount += CHUNK_SIZE;
        renderSongsListOnly();
        isLoadingMore = false;
    }, 500);
}

function saveSongsToIndexedDB(songs) {
    if (!dbIndexed) return;
    const tx = dbIndexed.transaction('offlineSongs', 'readwrite');
    const store = tx.objectStore('offlineSongs');
    store.clear();
    songs.forEach(song => store.put(song));
}

function loadSongsFromIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!dbIndexed) return resolve([]);
        const tx = dbIndexed.transaction('offlineSongs', 'readonly');
        const store = tx.objectStore('offlineSongs');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject([]);
    });
}

function fetchAllSongsSilently() {
    db.collection("songs").orderBy("createdAt", "desc").get().then((snapshot) => {
        songsList = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            songsList.push({ id: doc.id, ...data, createdAt: data.createdAt ? { seconds: data.createdAt.seconds } : null, updatedAt: data.updatedAt ? { seconds: data.updatedAt.seconds } : null });
        });
        isDataLoaded = true;
        renderSongs();
        updateTotalSongCount();
        saveSongsToIndexedDB(songsList);
        checkNewSongsNotification();
    }).catch(err => {
        const grid = document.getElementById('songGrid');
        if (grid && songsList.length === 0) {
            isDataLoaded = true;
            grid.innerHTML = `<div class="empty-state">
                <i class="fa-solid fa-wifi empty-icon"></i>
                <div class="empty-title">គ្មានការតភ្ជាប់</div>
                <div class="empty-desc">សូមភ្ជាប់អ៊ីនធឺណិតដើម្បីទាញយកទិន្នន័យលើកដំបូងសិន!</div>
            </div>`;
        }
    });
}

async function fetchAllSongsWithProgress() {
    const fetchBtn = document.getElementById('fetchAllBtn');
    const fetchIcon = document.getElementById('fetchIcon');
    const percentLabel = document.getElementById('progressPercent');

    fetchBtn.disabled = true;
    percentLabel.style.display = 'block';
    percentLabel.innerText = '0%';
    fetchIcon.className = 'fa-solid fa-spinner fa-spin';

    try {
        // ១. ទាញយកទិន្នន័យពី Firebase
        const snapshot = await db.collection("songs").orderBy("createdAt", "desc").get();
        songsList = [];
        let imageUrlsToCache = [];

        snapshot.forEach((doc) => {
            const data = doc.data();
            const song = { 
                id: doc.id, 
                ...data, 
                createdAt: data.createdAt ? { seconds: data.createdAt.seconds } : null, 
                updatedAt: data.updatedAt ? { seconds: data.updatedAt.seconds } : null 
            };
            songsList.push(song);

            // ប្រមូល URL រូបភាពសម្រាប់ទាញយកទុក (មិនខ្វល់ពី Audio ទេ)
            if (song.imageUrl && song.imageUrl.startsWith('http')) {
                imageUrlsToCache.push(song.imageUrl);
            }
        });

        // ២. រក្សាទុកអត្ថបទចូល IndexedDB
        saveSongsToIndexedDB(songsList);

        // ៣. ទាញយករូបភាពចូល Cache Storage
        if ('caches' in window && imageUrlsToCache.length > 0) {
            const cache = await caches.open('SongApp-Image-Cache-v1');
            let loadedImages = 0;
            let totalImages = imageUrlsToCache.length;

            for (const url of imageUrlsToCache) {
                try {
                    // ទាញយករូបភាពពី Server (ប្រើ mode: 'cors' សម្រាប់ Cloudinary/Firebase)
                    const response = await fetch(url, { mode: 'cors' });
                    if (response.ok) {
                        await cache.put(url, response);
                    }
                } catch (err) {
                    console.warn('មិនអាចទាញយករូបភាព៖', url);
                }
                
                loadedImages++;
                // បង្ហាញភាគរយពិតប្រាកដ
                let progress = Math.round((loadedImages / totalImages) * 100);
                percentLabel.innerText = progress + '%';
            }
        } else {
            percentLabel.innerText = '100%';
        }

        isDataLoaded = true;
        renderSongs();
        updateTotalSongCount();
        checkNewSongsNotification();

        setTimeout(() => markFetchCompleted(), 300);
        vibratePhone(100);
        showToast('ទាញយកអត្ថបទ និងរូបភាពរួចរាល់', 'success');

    } catch (err) {
        console.error(err);
        fetchBtn.disabled = false;
        percentLabel.style.display = 'none';
        fetchIcon.className = 'fa-solid fa-cloud-arrow-down';
        showToast('បរាជ័យក្នុងការទាញយក', 'error');
    }
}

function markFetchCompleted() {
    const fetchBtn = document.getElementById('fetchAllBtn');
    const fetchIcon = document.getElementById('fetchIcon');
    const percentLabel = document.getElementById('progressPercent');
    fetchBtn.disabled = false; fetchBtn.classList.add('completed'); fetchIcon.className = 'fa-solid fa-circle-check'; percentLabel.style.display = 'none';
}

function listenToAuth() {
    auth.onAuthStateChanged((user) => {
        currentUser = user;
        if (user) {
            const adminEmails = ["phallakhum6@gmail.com"]; 
            
            if (adminEmails.includes(user.email)) {
                isAdmin = true;
                isEditor = true;
            } else {
                isAdmin = false;
                isEditor = false;
            }
            updateUIRoles();

            db.collection("users").doc(user.uid).get().then((doc) => {
                if (doc.exists) { 
                    const userData = doc.data(); 
                    if (userData.playlists) {
                        playlists = Object.assign({}, playlists, userData.playlists);
                        localStorage.setItem('user_playlists', JSON.stringify(playlists));
                        renderPlaylistsView();
                        renderSongsListOnly();
                    } else {
                        syncPlaylistsToCloud();
                    }
                }
            }).catch(() => {});

        } else { 
            isAdmin = false; 
            isEditor = false; 
            updateUIRoles(); 
        }
    });
}

function updateUIRoles() {
    const body = document.getElementById('bodyContainer');
    if (isEditor) {
        body.classList.add('editor-authorized'); 
    } else {
        body.classList.remove('editor-authorized');
        const adminPanel = document.getElementById('secretAdminPanel');
        if(adminPanel) adminPanel.style.display = 'none';
    }
    
    if (document.getElementById('viewSettings').classList.contains('active')) renderSettingsView();
    renderSongsListOnly();
    
    const viewHome = document.getElementById('viewHome');
    if (viewHome && viewHome.classList.contains('active')) {
        renderHomeView();
    }
}

function listenToAlbums() {
    db.collection("albums").onSnapshot((snapshot) => {
        const list = [];
        snapshot.forEach((doc) => list.push(doc.data().name));
        if (list.length > 0) customAlbums = Array.from(new Set(['ទំនុកដំកើង', 'ទំនុកខ្មែរបរិសុទ្ធ', ...list]));
        populateAlbumDropdowns();
    });
}

function populateAlbumDropdowns() {
    const options = customAlbums.map(a => `<option value="${a}">${a}</option>`).join('');
    ['songAlbumSelect', 'batchAlbumSelect', 'editSongAlbumSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = options;
    });
}

function getSongCover(song) {
    if (song && song.imageUrl && song.imageUrl.length > 10) return song.imageUrl;
    return 'https://via.placeholder.com/600x800?text=Song';
}

function getRecentHistorySongs(limit = 6) {
    const ids = JSON.parse(localStorage.getItem('recent_history') || '[]');
    const ordered = ids.map(id => songsList.find(s => s.id === id)).filter(Boolean);
    return ordered.slice(0, limit);
}

function getCardThumbnailHTML(song, isSmall = false) {
    if (song && song.imageUrl && song.imageUrl.length > 10) {
        return `<img src="${song.imageUrl}" alt="" loading="lazy">`;
    } else if (song && song.lyrics) {
        if (isSmall) {
            return `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg, var(--primary), #4f46e5); color:white; font-size:1.2rem;"><i class="fa-solid fa-music"></i></div>`;
        } else {
            const previewText = escapeHtml(song.lyrics).replace(/\[.*?\]/g, '').substring(0, 60) + '...';
            return `<div style="width:100%; height:100%; padding:10px; font-size:0.65rem; line-height:1.4; color:var(--text); background:var(--bg); text-align:left; overflow:hidden; white-space:pre-wrap; font-family:'Kantumruy Pro', sans-serif;">${previewText}</div>`;
        }
    }
    return `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--primary); font-size: ${isSmall ? '1.2rem' : '2rem'};"><i class="fa-solid fa-music"></i></div>`;
}

function getSundaysInCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    let sundays = 0;
    for (let day = 1; day <= 31; day++) {
        const d = new Date(year, month, day);
        if (d.getMonth() !== month) break; 
        if (d.getDay() === 0) sundays++;   
    }
    return sundays;
}

function checkAndResetMonthlySetlists() {
    if (!isEditor) return;

    const khmerNums = ['១', '២', '៣', '៤', '៥']; 
    const now = new Date();
    const currentMonthStr = `\({now.getFullYear()}-\){now.getMonth()}`;
    const lastMonthStr = localStorage.getItem('admin_last_setlist_month');
    
    let hasChanges = false;
    let newSetlists = {}; 
    const totalSundays = getSundaysInCurrentMonth();
    
    let expectedKeys = [];
    for (let i = 1; i <= totalSundays; i++) {
        expectedKeys.push(`សប្តាហ៍ទី${khmerNums[i-1]}`);
    }

    let isNewMonth = (lastMonthStr !== currentMonthStr);

    if (isNewMonth) {
        expectedKeys.forEach(key => {
            newSetlists[key] = [];
        });
        hasChanges = true;
    } else {
        expectedKeys.forEach(key => {
            if (globalSetlists[key]) {
                newSetlists[key] = globalSetlists[key];
            } else {
                newSetlists[key] = [];
                hasChanges = true;
            }
        });
    }

    const currentKeys = Object.keys(globalSetlists);
    const hasExtraKeys = currentKeys.some(key => !expectedKeys.includes(key));
    if (hasExtraKeys) hasChanges = true;

    if (hasChanges) {
        db.collection("public_settings").doc("setlists").set(newSetlists).then(() => {
            localStorage.setItem('admin_last_setlist_month', currentMonthStr);
        }).catch(err => {
            console.error("Setlist update error:", err);
        });
    } else {
        localStorage.setItem('admin_last_setlist_month', currentMonthStr);
    }
}

function renderHomeView() {
    const continueList = document.getElementById('homeContinueList');
    const setlistList = document.getElementById('homeSetlistList');
    
    if (!songsList || songsList.length === 0) {
        if (continueList) continueList.innerHTML = '<div class="home-empty-inline" style="width:100%;">កំពុងទាញយកបទចម្រៀង...</div>';
        if (setlistList) setlistList.innerHTML = '<div class="home-empty-inline" style="width:100%;">សូមរង់ចាំបន្តិច...</div>';
        return;
    }

    // ផ្នែក New Releases (ប្រវត្តិស្តាប់ថ្មីៗ) - Card ទ្រវែង
    const history = getRecentHistorySongs(6);
    if (continueList) {
        const source = history.length ? history : songsList.slice(0, 6);
        continueList.innerHTML = source.map(song => {
            const inFav = (playlists['Favorite'] || []).includes(song.id);
            let coverHtml = '';
            if (song.imageUrl && song.imageUrl.length > 10) {
                coverHtml = `<img src="${song.imageUrl}" alt="${escapeHtml(song.title)}" loading="lazy">`;
            } else {
                coverHtml = `<div class="fallback-cover"><i class="fa-solid fa-music"></i></div>`;
            }
            return `
            <div class="modern-landscape-card" onclick="openFullScreenModal('${song.id}')">
                <div class="modern-card-img-wrapper landscape">
                    ${coverHtml}
                    <!-- ប៊ូតុង Play តូចនៅមុំខាងឆ្វេង -->
                    <button class="modern-play-btn" onclick="playFloatingAudio('${song.id}', event)"><i class="fa-solid fa-play"></i></button>
                </div>
                <div class="modern-card-info">
                    <div class="modern-card-text">
                        <strong>${escapeHtml(song.title || 'បទចម្រៀង')}</strong>
                        <span>${escapeHtml(song.artist || 'មិនស្គាល់')}</span>
                    </div>
                    <button class="modern-heart-btn ${inFav ? 'active' : ''}" onclick="toggleFavorite('${song.id}', event)">
                        <i class="${inFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    }

   // ផ្នែក Trending Now (Setlists) - Card ការ៉េ
    if (setlistList) {
        const totalSundays = getSundaysInCurrentMonth();
        const khmerNums = ['១', '២', '៣', '៤', '៥']; 
        const weeks = [];
        for (let i = 1; i <= totalSundays; i++) {
            weeks.push(`សប្តាហ៍ទី${khmerNums[i-1]}`);
        }
        if (!globalSetlists) globalSetlists = {};

        // រូបភាពជំនួសសម្រាប់ Setlist (Random)
        const genericImages = [
            "https://lh3.googleusercontent.com/d/18AIuYlcZ16nBkcnNdjfg-q1TXBWvpZlJ",
            "https://lh3.googleusercontent.com/d/1EMRwJM4HMRmtioSp0Zsy-Vu8qFQhIJUB",
            "https://lh3.googleusercontent.com/d/1U5WYEYYJ6r9ZD9T4C0qBpU1SvZXrBTtQ",
            "https://lh3.googleusercontent.com/d/1Bd0FVs00khBVM9qlhz4z7aWz9XUCEFh4",
            "https://lh3.googleusercontent.com/d/1JY-gKNv73mJocbJ0bWBBnQRjUY3bbBmI"
        ];

        setlistList.innerHTML = weeks.map((week, index) => {
            const count = (globalSetlists[week] || []).length;
            const imgUrl = genericImages[index % genericImages.length];
            return `
            <div class="modern-square-card" onclick="filterBySetlist('${week}')">
                <div class="modern-card-img-wrapper square">
                    <img src="${imgUrl}" alt="${week}" loading="lazy">
                    <div class="modern-play-btn"><i class="fa-solid fa-list"></i></div>
                </div>
                <div class="modern-card-info">
                    <div class="modern-card-text">
                        <strong>${week}</strong>
                        <span>${count} បទចម្រៀង</span>
                    </div>
                    <button class="modern-heart-btn" onclick="event.stopPropagation(); filterBySetlist('${week}')">
                        <i class="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    }
}




function handleDragStart(e, songId) {
    dragSrcId = songId;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => e.target.classList.add('dragging'), 50);
}
function handleDragOver(e) {
    e.preventDefault(); 
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.song-card');
    if(card) {
        document.querySelectorAll('.song-card').forEach(c => c.classList.remove('drag-over'));
        card.classList.add('drag-over');
    }
    return false;
}
function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.song-card').forEach(c => c.classList.remove('drag-over'));
}
function handleDrop(e, targetSongId) {
    e.stopPropagation();
    document.querySelectorAll('.song-card').forEach(c => c.classList.remove('drag-over'));
    
    if (dragSrcId && dragSrcId !== targetSongId) {
        if (currentFilterType === 'PLAYLIST') {
            const pName = currentFilterValue;
            const list = playlists[pName];
            const fromIdx = list.indexOf(dragSrcId);
            const toIdx = list.indexOf(targetSongId);
            if (fromIdx > -1 && toIdx > -1) {
                list.splice(fromIdx, 1);
                list.splice(toIdx, 0, dragSrcId);
                localStorage.setItem('user_playlists', JSON.stringify(playlists));
                vibratePhone(50);
                syncPlaylistsToCloud();
                renderSongs();
            }
        } else if (currentFilterType === 'SETLIST' && isEditor) {
            const week = currentFilterValue;
            const list = globalSetlists[week];
            const fromIdx = list.indexOf(dragSrcId);
            const toIdx = list.indexOf(targetSongId);
            if (fromIdx > -1 && toIdx > -1) {
                list.splice(fromIdx, 1);
                list.splice(toIdx, 0, dragSrcId);
                db.collection("public_settings").doc("setlists").set(globalSetlists, { merge: true });
                vibratePhone(50);
                renderSongs();
            }
        }
    }
    return false;
}    

function toggleSongMenu(event, songId) {
    event.stopPropagation();
    document.querySelectorAll('.card-dropdown').forEach(el => {
        if(el.id !== `dropdown-${songId}`) el.classList.remove('show');
    });
    const menu = document.getElementById(`dropdown-${songId}`);
    if(menu) menu.classList.toggle('show');
}

function highlightSearchText(text, query) {
    if (!query) return escapeHtml(text);
    const safeText = escapeHtml(text);
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeQuery})`, 'gi');
    return safeText.replace(regex, '<span class="highlight">$1</span>');
}

// ១. Function សម្អាតតួអក្សរ (លុបវង់ក្រចក សញ្ញាខណ្ឌ និងអក្សរលាក់)
function cleanKhmerChars(text) {
    if (!text) return '';
    return text.normalize('NFC')
               .toLowerCase()
               // លុប ZWSP, ៊, ៉, វង់ក្រចក () [] {} និងសញ្ញាខណ្ឌផ្សេងៗ
               .replace(/[\u200B\u200C\u200D\uFEFF\u17CA\u17C9\(\)\[\]\{\}\<\>\-\_\.\,\"\'\“\”\‘\’]/g, '');
}

// ២. Function សម្រាប់ដំណើរការ Search Dropdown ពេលវាយភ្លាមៗ
function handleSearchInput() {
    const input = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    const rawVal = input.value;
    
    // កាត់ពាក្យតាមការដកឃ្លា
    const rawTerms = rawVal.split(/\s+/).filter(t => t.length > 0);
    const searchTerms = rawTerms.map(t => cleanKhmerChars(t));
    
    const dropdown = document.getElementById('searchDropdown');

    if (rawVal.trim().length > 0) clearBtn.style.display = 'flex';
    else clearBtn.style.display = 'none';

    renderSongs(); 

    if (searchTerms.length === 0) { hideSearchDropdown(); return; }

    // 🔴 កំណត់ទិន្នន័យគោលសម្រាប់ស្វែងរក (បើកំពុងបើក Album យកតែបទក្នុង Album នោះមកបង្ហាញ)
    let sourceList = songsList;
    if (currentFilterType === 'ALBUM') {
        sourceList = songsList.filter(s => s.album === currentFilterValue);
    }

    let matches = sourceList.filter(s => {
        const fullText = cleanKhmerChars((s.title || '') + ' ' + (s.artist || ''))
                         .replace(/\s+/g, ''); // លុប Space ចេញពីទិន្នន័យដើម
        return searchTerms.every(term => fullText.includes(term.replace(/\s+/g, '')));
    });

    const exactSearchStr = cleanKhmerChars(rawVal).replace(/\s+/g, '');
    matches.sort((a, b) => {
        const aTitle = cleanKhmerChars(a.title).replace(/\s+/g, '');
        const bTitle = cleanKhmerChars(b.title).replace(/\s+/g, '');
        
        if (aTitle === exactSearchStr && bTitle !== exactSearchStr) return -1;
        if (bTitle === exactSearchStr && aTitle !== exactSearchStr) return 1;
        if (aTitle.startsWith(exactSearchStr) && !bTitle.startsWith(exactSearchStr)) return -1;
        if (bTitle.startsWith(exactSearchStr) && !aTitle.startsWith(exactSearchStr)) return 1;
        return 0;
    });

    matches = matches.slice(0, 50); // បង្ហាញ ១៥ បទក្នុង Dropdown កុំឲ្យបាំងពេក

    if (matches.length > 0) {
        dropdown.innerHTML = matches.map(s => `
            <div class="search-dropdown-item" onclick="selectSearchDropdownItem('${s.id}')">
                <div>
                    <div class="search-dropdown-title">${escapeHtml(s.title)}</div>
                    <div class="search-dropdown-artist">🎤 ${escapeHtml(s.artist || 'មិនស្គាល់')}</div>
                </div>
                <i class="fa-solid fa-chevron-right" style="font-size: 0.7rem; color: var(--text-muted);"></i>
            </div>
        `).join('');
        dropdown.style.display = 'block';
    } else {
        dropdown.innerHTML = '<div class="search-dropdown-item" style="color:var(--text-muted);">រកមិនឃើញចម្រៀងឡើយ</div>';
        dropdown.style.display = 'block';
    }
}

// ៣. Function សម្រាប់ Update Grid ខាងក្រោម
function renderSongs() {
    const rawVal = document.getElementById('searchInput').value;
    const rawTerms = rawVal.split(/\s+/).filter(t => t.length > 0);
    const searchTerms = rawTerms.map(t => cleanKhmerChars(t));
    
    let filtered = [];
    
    if (currentFilterType === 'PLAYLIST') {
        const pList = playlists[currentFilterValue] || [];
        filtered = pList.map(id => songsList.find(s => s.id === id)).filter(s => s);
    } else if (currentFilterType === 'SETLIST') {
        const pList = globalSetlists[currentFilterValue] || [];
        filtered = pList.map(id => songsList.find(s => s.id === id)).filter(s => s);
    } else if (currentFilterType === 'RECENT') {
        filtered = [...songsList].sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.seconds : 0;
            const timeB = b.createdAt ? b.createdAt.seconds : 0;
            return timeB - timeA;
        });
    } else if (currentFilterType === 'HISTORY') { 
        const historyIds = JSON.parse(localStorage.getItem('recent_history') || '[]');
        filtered = historyIds.map(id => songsList.find(s => s.id === id)).filter(s => s);
    } else {
        filtered = [...songsList];
    }

    currentFilteredSongs = filtered.filter(song => {
        const safeTitle = cleanKhmerChars(song.title || '');
        const safeArtist = cleanKhmerChars(song.artist || '');
        const safeAlbum = cleanKhmerChars(song.album || '');
        const safeKey = cleanKhmerChars(song.songKey || '');
        
        const fullString = `${safeTitle}${safeArtist}${safeAlbum}${safeKey}`.replace(/\s+/g, '');
        
        const matchSearch = searchTerms.every(term => fullString.includes(term.replace(/\s+/g, '')));

        let matchFilter = true;
        if (currentFilterType === 'ALBUM') matchFilter = song.album === currentFilterValue;
        
        return matchSearch && matchFilter;
    });

    if (searchTerms.length > 0) {
        const exactSearchStr = cleanKhmerChars(rawVal).replace(/\s+/g, '');
        currentFilteredSongs.sort((a, b) => {
            const aTitle = cleanKhmerChars(a.title).replace(/\s+/g, '');
            const bTitle = cleanKhmerChars(b.title).replace(/\s+/g, '');
            
            if (aTitle === exactSearchStr && bTitle !== exactSearchStr) return -1;
            if (bTitle === exactSearchStr && aTitle !== exactSearchStr) return 1;
            if (aTitle.startsWith(exactSearchStr) && !bTitle.startsWith(exactSearchStr)) return -1;
            if (bTitle.startsWith(exactSearchStr) && !aTitle.startsWith(exactSearchStr)) return 1;
            return 0;
        });
    }

    displayedItemCount = 20;
    
    const dragInfo = document.getElementById('playlistDragInfo');
    const shareBtn = document.getElementById('sharePlaylistBtn');

    if (currentFilterType === 'PLAYLIST' && currentFilterValue !== 'Favorite') {
        if (dragInfo) dragInfo.style.display = 'block';
        if (shareBtn) shareBtn.style.display = 'inline-flex'; 
    } else if (currentFilterType === 'SETLIST') {
        if (dragInfo) dragInfo.style.display = isEditor ? 'block' : 'none'; 
        if (shareBtn) shareBtn.style.display = 'inline-flex'; 
    } else {
        if (dragInfo) dragInfo.style.display = 'none';
        if (shareBtn) shareBtn.style.display = 'none';
    }
    const searchBtn = document.getElementById('searchSongBtn');
    const viewToggleBtn = document.getElementById('viewToggleBtn');

   // ថែមលក្ខខណ្ឌ currentFilterType === 'SETLIST' បញ្ចូល
    if (currentFilterType === 'PLAYLIST' || currentFilterType === 'SETLIST') {
        // លាក់ប៊ូតុងពេលចូល Playlist, Favorite ឬ Setlist
        if (searchBtn) searchBtn.style.display = 'none';
        if (viewToggleBtn) viewToggleBtn.style.display = 'none';
    } else {
        // បង្ហាញប៊ូតុងវិញពេលនៅទំព័រផ្សេងៗ (ឧ. Home, Songs, Albums)
        if (searchBtn) searchBtn.style.display = 'inline-block';
        if (viewToggleBtn) viewToggleBtn.style.display = 'inline-block';
    }


    renderSongsListOnly();
}


function clearSearchInput() {
    const input = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    input.value = ''; clearBtn.style.display = 'none';
    hideSearchDropdown(); renderSongs(); input.focus();
}

function hideSearchDropdown() { const dropdown = document.getElementById('searchDropdown'); if (dropdown) dropdown.style.display = 'none'; }

function selectSearchDropdownItem(songId) { 
    hideSearchDropdown(); 
    const song = songsList.find(s => s.id === songId);
    if (song) {
        document.getElementById('searchInput').value = song.title;
        handleSearchInput();
    }
}

function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';

    currentFilterType = 'ALL'; currentFilterValue = 'ALL';
    document.getElementById('sectionTitleText').innerText = "បទចម្រៀងទាំងអស់";
    document.getElementById('currentAlbumSubtitle').innerHTML = `Khmer Christian Worship Songs`;
    toggleFilterUI(false);
    renderSongs();
}

function filterByAlbum(albumName) {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';

    currentFilterType = 'ALBUM'; currentFilterValue = albumName; switchTab('songs');
    document.getElementById('sectionTitleText').innerHTML = escapeHtml(albumName);
    document.getElementById('currentAlbumSubtitle').innerHTML = '';
    toggleFilterUI(true);
    renderSongs();
}

function filterBySetlist(weekName) {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';

    currentFilterType = 'SETLIST'; currentFilterValue = weekName; switchTab('songs');
    document.getElementById('sectionTitleText').innerHTML = '📅 ' + escapeHtml(weekName);
    document.getElementById('currentAlbumSubtitle').innerHTML = 'Public Setlist';
    toggleFilterUI(true);
    renderSongs();
}

function filterByPlaylist(playlistName) {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';

    currentFilterType = 'PLAYLIST'; currentFilterValue = playlistName; switchTab('songs');
    const icon = playlistName === 'Favorite' ? '❤️ ' : '';
    document.getElementById('sectionTitleText').innerHTML = icon + escapeHtml(playlistName);
    document.getElementById('currentAlbumSubtitle').innerHTML = '';
    toggleFilterUI(true);
    renderSongs();
}

function renderAlbumsView() {
    const grid = document.getElementById('albumsGrid'); if (!grid) return;
    
    grid.innerHTML = customAlbums.map(album => {
        const count = songsList.filter(s => s.album === album).length;
        const isDefault = (album === 'ទំនុកដំកើង' || album === 'ទំនុកខ្មែរបរិសុទ្ធ');
        
        return `
            <div class="folder-card" onclick="filterByAlbum('${escapeHtml(album)}')">
                ${!isDefault && isEditor ? `<button class="folder-delete-btn" onclick="deleteAlbum(event, '${escapeHtml(album)}')"><i class="fa-solid fa-trash"></i></button>` : ''}
                <div class="folder-icon-wrapper">
                    <i class="fa-solid fa-folder"></i>
                </div>
                <div class="folder-name" title="${escapeHtml(album)}">${escapeHtml(album)}</div>
                <div class="folder-count">${count} បទ</div>
            </div>`;
    }).join('');
}

function renderPlaylistsView() {
    const grid = document.getElementById('playlistsGrid');
    if (!grid) return;

    const keys = Object.keys(playlists);
    
    const customKeys = keys.filter(k => k !== 'Favorite');
    
    if (customKeys.length === 0) { 
        grid.innerHTML = `
            <div class="empty-state" style="margin-top: 30px; grid-column: 1 / -1;">
                <i class="fa-regular fa-folder-open empty-icon" style="font-size: 3.5rem; margin-bottom: 10px;"></i>
                <div class="empty-title" style="font-size: 1.1rem;">ពុំទាន់មាន Playlist ទេ</div>
                <div class="empty-desc" style="font-size: 0.85rem;">ចុចប៊ូតុង "បង្កើតថ្មី" ខាងលើ ដើម្បីរៀបចំបទចម្រៀងសម្រាប់ការថ្វាយបង្គំ។</div>
            </div>`; 
        return; 
    }
    
    grid.innerHTML = customKeys.map(pName => {
        const count = (playlists[pName] || []).length;
        
        return `
            <div class="folder-card" onclick="filterByPlaylist('${escapeHtml(pName)}')">
                <button class="folder-delete-btn" onclick="deletePlaylist(event, '${escapeHtml(pName)}')"><i class="fa-solid fa-trash"></i></button>
                <div class="folder-icon-wrapper">
                    <i class="fa-solid fa-list-ul"></i>
                </div>
                <div class="folder-name" title="${escapeHtml(pName)}">${escapeHtml(pName)}</div>
                <div class="folder-count">${count} បទ</div>
            </div>`;
    }).join('');
}

function renderSettingsView() {
    const accountContainer = document.getElementById('settingsAccountArea'); 
    const authBottomContainer = document.getElementById('bottomAuthArea');
    const notifContainer = document.getElementById('settingsNotificationsList');
    if (!accountContainer || !authBottomContainer || !notifContainer) return;

    if (currentUser) {
        accountContainer.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; padding: 14px 16px;">
                <img src="${currentUser.photoURL || 'https://via.placeholder.com/100'}" style="width:50px; height:50px; border-radius:50%; object-fit:cover; border:2px solid var(--primary);" alt="User">
                <div>
                    <div style="font-size:0.95rem; font-weight:700; color:var(--text);">${escapeHtml(currentUser.displayName || 'អ្នកប្រើប្រាស់')}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(currentUser.email || '')}</div>
                    <span style="display:inline-block; font-size:0.68rem; color:#16a34a; font-weight:700; margin-top:2px;">${isAdmin ? '👑 Admin' : (isEditor ? '✏️ Editor' : '👤 សមាជិក')}</span>
                </div>
            </div>
        `;
        authBottomContainer.innerHTML = `
            <button class="settings-card settings-item danger" style="width:100%; justify-content:center; padding: 16px; margin-bottom: 0;" onclick="handleLogout()">
                <div class="settings-item-left"><i class="fa-solid fa-right-from-bracket"></i> ចាកចេញ (Logout)</div>
            </button>
        `;
    } else {
        accountContainer.innerHTML = `
            <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                អ្នកមិនទាន់បានចូលប្រព័ន្ធទេ
            </div>
        `;
        authBottomContainer.innerHTML = `
            <button class="settings-card settings-item" style="width:100%; justify-content:center; color: var(--primary); padding: 16px; margin-bottom: 0;" onclick="handleGoogleLogin()">
                <div class="settings-item-left"><i class="fa-brands fa-google"></i> Login Email </div>
            </button>
        `;
    }

    if (songsList && songsList.length > 0) {
        const latestSongs = songsList.slice(0, 10);
        notifContainer.innerHTML = latestSongs.map(song => `
            <div class="settings-item" onclick="openFullScreenModal('${song.id}')">
                <div class="settings-item-left">
                    <i class="fa-solid fa-music" style="color: var(--primary);"></i>
                    <div>
                        <div style="font-weight: 600; font-size: 0.88rem;">${escapeHtml(song.title)}</div>
                        <div style="font-size: 0.72rem; color: var(--text-muted);">អាល់ប៊ុម៖ ${escapeHtml(song.album || 'ទូទៅ')}</div>
                    </div>
                </div>
                <i class="fa-solid fa-chevron-right" style="color: var(--border);"></i>
            </div>
        `).join('');
    } else {
        notifContainer.innerHTML = `<div style="padding: 14px 16px; font-size: 0.85rem; color: var(--text-muted); text-align: center;">គ្មានការជូនដំណឹងថ្មីទេ</div>`;
    }
}

async function clearOfflineData() {
    if(confirm('តើអ្នកពិតជាចង់លុបទិន្នន័យ និងរូបភាព Offline ទាំងអស់មែនទេ? (វានឹងមិនលុប Playlist របស់អ្នកឡើយ)')) {
        // លុបអត្ថបទពី IndexedDB
        if(dbIndexed) {
            const tx = dbIndexed.transaction('offlineSongs', 'readwrite');
            tx.objectStore('offlineSongs').clear();
        }
        
        // លុបរូបភាពពី Cache Storage
        if ('caches' in window) {
            await caches.delete('SongApp-Image-Cache-v1');
        }
        
        vibratePhone(50);
        showToast('ជម្រះទិន្នន័យរួចរាល់', 'success');
        setTimeout(() => window.location.reload(), 1000);
    }
}

function openFullScreenModal(songId) {
    const songIndex = currentFilteredSongs.findIndex(s => s.id === songId); if (songIndex === -1) return;
    let history = JSON.parse(localStorage.getItem('recent_history') || '[]');
    history = history.filter(id => id !== songId);
    history.unshift(songId);
    if (history.length > 15) history.pop();
    localStorage.setItem('recent_history', JSON.stringify(history));
    
    currentFullscreenIndex = songIndex; updateFullScreenContent(); document.getElementById('fullScreenModal').classList.add('active');
    requestWakeLock(); 
    document.body.classList.remove('no-scroll');
}

function closeFullScreenModalDirect() { 
    document.getElementById('fullScreenModal').classList.remove('active'); 
    resetZoomState(); 
    releaseWakeLock(); 
}

function slideFullScreen(direction, event) {
    if (event) event.stopPropagation();
    currentFullscreenIndex += direction;
    if (currentFullscreenIndex < 0) currentFullscreenIndex = currentFilteredSongs.length - 1;
    if (currentFullscreenIndex >= currentFilteredSongs.length) currentFullscreenIndex = 0;
    updateFullScreenContent();
    vibratePhone(30);
}

let scale = 1, pointX = 0, pointY = 0, startX = 0, startY = 0, initialDist = 0, isDragging = false, isPinching = false, lastTapTime = 0, animFrame = null;
let currentRotation = 0; // អញ្ញាតសម្រាប់កត់ត្រាមុំបង្វិល

function resetZoomState() { scale = 1; pointX = 0; pointY = 0; updateTransform(); }
function updateTransform() {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(() => {
        const img = document.getElementById('fullScreenImg');
        const container = document.getElementById('fullScreenImgContainer');
        
        if (img && container) {
            // ទាញយកទំហំពិតប្រាកដរបស់អេក្រង់ (ដកចន្លោះគែមខាងៗចេញ)
            const style = window.getComputedStyle(container);
            const cw = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const ch = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

            // កំណត់ទំហំរូបភាពឡើងវិញពេលបង្វិលផ្តេក ៩០ ឬ ២៧០ ដឺក្រេ 
            if (currentRotation === 90 || currentRotation === 270) {
                img.style.maxWidth = ch + "px";
                img.style.maxHeight = cw + "px";
            } else {
                img.style.maxWidth = "100%";
                img.style.maxHeight = "100%";
            }

            img.style.transform = "translate3d(" + pointX + "px, " + pointY + "px, 0px) scale(" + scale + ") rotate(" + currentRotation + "deg)";
        }
    });
}

function rotateImage() {
    currentRotation += 90;
    if (currentRotation >= 360) currentRotation = 0;
    updateTransform();
    
    // បង្ហាញសារប្រាប់អ្នកប្រើប្រាស់ ពេលរូបភាពផ្តេក
    if (currentRotation === 90 || currentRotation === 270) {
        showToast("ទម្រង់អានផ្តេក", "info");
    }
}

function initPinchToZoom() {
    const container = document.getElementById('fullScreenImgContainer'); const img = document.getElementById('fullScreenImg');
    if (!container || !img) return;
    function getDistance(touches) { return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); }
    
    container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) { 
            isPinching = true; 
            isDragging = false; 
            initialDist = getDistance(e.touches); 
        } else if (e.touches.length === 1) { 
            if (scale > 1) { 
                isDragging = true; 
                startX = e.touches[0].clientX - pointX; 
                startY = e.touches[0].clientY - pointY; 
            } else { 
                startX = e.touches[0].clientX; 
            } 
        }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (isAutoScrolling) { e.preventDefault(); return; }

        if (isPinching && e.touches.length === 2) { 
            const newDist = getDistance(e.touches); 
            if (initialDist > 0) { 
                scale = Math.min(Math.max(1, scale * (newDist / initialDist)), 4); 
                initialDist = newDist; 
                if (scale === 1) { pointX = 0; pointY = 0; } 
                updateTransform(); 
            } 
        } else if (isDragging && e.touches.length === 1 && scale > 1) { 
            pointX = e.touches[0].clientX - startX; 
            pointY = e.touches[0].clientY - startY; 
            updateTransform(); 
        }
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) isPinching = false; 
        if (e.touches.length === 0) { 
            if (scale <= 1) resetZoomState(); 
            isDragging = false; 
        }
        if (e.changedTouches.length === 1 && scale === 1 && !isPinching) { 
            const diffX = e.changedTouches[0].clientX - startX; 
            if (Math.abs(diffX) > 60) diffX < 0 ? slideFullScreen(1) : slideFullScreen(-1); 
        }
       const now = new Date().getTime(); const tapGap = now - lastTapTime;
         if (tapGap < 300 && tapGap > 0) { 
    // បន្ថែមលក្ខខណ្ឌបើមានការបង្វិល ក៏ត្រូវ Reset មកដើមវិញដែរ
         if (scale > 1 || currentRotation !== 0) { 
        currentRotation = 0; 
        resetZoomState(); 
    } 
        else { scale = 2.5; pointX = 0; pointY = 0; updateTransform(); } 
    }
        lastTapTime = now;
    });
}

function shareAppDirectly() {
    if (navigator.share) {
        navigator.share({
            title: 'ចម្រៀងសរសើរដំកើងព្រះ',
            text: 'សូមចូលរួមប្រើប្រាស់កម្មវិធីចម្រៀងសរសើរដំកើងព្រះជាមួយយើងខ្ញុំ។',
            url: window.location.href
        }).catch(console.error);
    } else {
        showToast('ការចែករំលែកមិនដំណើរការលើ Browser នេះទេ', 'warning');
    }
}

function toggleFavorite(songId, event) {
    if(event) event.stopPropagation();
    vibratePhone(50);
    if (!playlists['Favorite']) playlists['Favorite'] = [];
    const index = playlists['Favorite'].indexOf(songId);
    if (index === -1) playlists['Favorite'].push(songId); else playlists['Favorite'].splice(index, 1);
    localStorage.setItem('user_playlists', JSON.stringify(playlists)); 
    syncPlaylistsToCloud();
    renderSongsListOnly();
}

function openModal(modalId) { 
    document.getElementById(modalId).classList.add('active'); 
    document.body.classList.add('no-scroll');
}
function closeModal(modalId) { 
    document.getElementById(modalId).classList.remove('active'); 
    document.body.classList.remove('no-scroll');
}

function openCreatePlaylistModal() { openModal('playlistModal'); }

function openPlaylistChooserModal(songId) {
    document.getElementById('playlistTargetSongId').value = songId;
    
    const listContainer = document.getElementById('existingPlaylistsList');
    const keys = Object.keys(playlists);
    if(keys.length === 0) listContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">គ្មាន Playlist ស្រាប់ទេ</div>';
    else listContainer.innerHTML = keys.map(p => `<button type="button" onclick="addSongToPlaylist('${p}')" style="display:flex; justify-content:space-between; align-items:center; width:100%; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); padding:10px; font-size:0.85rem; margin-bottom: 6px;"><span>📂 ${escapeHtml(p)}</span><i class="fa-solid fa-plus"></i></button>`).join('');
    
    const setlistContainer = document.getElementById('adminSetlistContainer');
    if (isEditor) {
        const sKeys = Object.keys(globalSetlists);
        let sHtml = sKeys.map(w => `<button type="button" onclick="addSongToSetlist('${w}')" style="display:flex; justify-content:space-between; align-items:center; width:100%; border:1px solid var(--primary); border-radius:8px; background:rgba(37,99,235,0.05); color:var(--primary); padding:10px; font-size:0.85rem; font-weight: 600; margin-bottom: 6px;"><span>📅 ${escapeHtml(w)}</span><i class="fa-solid fa-plus"></i></button>`).join('');
        document.getElementById('existingSetlistsList').innerHTML = sHtml;
        setlistContainer.style.display = 'block';
    } else {
        if(setlistContainer) setlistContainer.style.display = 'none';
    }
    
    openModal('playlistModal');
}

function addSongToSetlist(weekName) {
    const songId = document.getElementById('playlistTargetSongId').value;
    if (!globalSetlists[weekName]) globalSetlists[weekName] = [];
    if (!globalSetlists[weekName].includes(songId)) { 
        globalSetlists[weekName].push(songId); 
        db.collection("public_settings").doc("setlists").set(globalSetlists, { merge: true }).then(() => {
            showToast(`បានបញ្ចូលទៅ ${weekName} ជោគជ័យ`, 'success'); 
        }).catch(err => {
            showToast(`មិនអាចបញ្ចូលបានទេ៖ ${err.message}`, 'error');
        });
    } else {
        showToast(`បទនេះមានក្នុង ${weekName} រួចហើយ`, 'warning');
    }
    closeModal('playlistModal');
}

function addSongToPlaylist(playlistName) {
    const songId = document.getElementById('playlistTargetSongId').value;
    if (!playlists[playlistName]) playlists[playlistName] = [];
    if (!playlists[playlistName].includes(songId)) { 
        playlists[playlistName].push(songId); 
        localStorage.setItem('user_playlists', JSON.stringify(playlists)); 
        syncPlaylistsToCloud();
        showToast('បានបញ្ចូលទៅ Playlist ជោគជ័យ', 'success'); 
    }
    closeModal('playlistModal');
}

function saveNewPlaylist() {
    const input = document.getElementById('newPlaylistName'); const songId = document.getElementById('playlistTargetSongId').value; const name = input.value.trim();
    if (!name) return;
    if (!playlists[name]) { 
        playlists[name] = songId ? [songId] : []; 
        localStorage.setItem('user_playlists', JSON.stringify(playlists)); 
        syncPlaylistsToCloud();
        input.value = ''; 
        closeModal('playlistModal'); 
        renderPlaylistsView(); 
        showToast('បង្កើត Playlist ថ្មីជោគជ័យ', 'success'); 
    }
}

function deletePlaylist(event, pName) { 
    event.stopPropagation(); 
    if (confirm(`លុប Playlist "${pName}"?`)) { 
        delete playlists[pName]; 
        localStorage.setItem('user_playlists', JSON.stringify(playlists)); 
        syncPlaylistsToCloud();
        renderPlaylistsView(); 
        showToast('លុប Playlist រួចរាល់', 'info'); 
    } 
}


window.addEventListener('online', () => updateOnlineStatus()); 
window.addEventListener('offline', () => updateOnlineStatus());

function updateOnlineStatus() {
    const badge = document.getElementById('offlineSyncBadge');
    const dot = document.getElementById('statusDot'); 
    const text = document.getElementById('statusText');
    if (!badge || !dot || !text) return;
    
    if (navigator.onLine) { 
        dot.className = 'status-dot status-online'; 
        text.innerText = 'អនឡាញ'; 
    } else { 
        dot.className = 'status-dot status-offline'; 
        text.innerText = 'បាត់ការតភ្ជាប់ (Offline)'; 
    }

    badge.classList.add('show');
    setTimeout(() => {
        badge.classList.remove('show');
    }, 3000);
}

function handleGoogleLogin() { const provider = new firebase.auth.GoogleAuthProvider(); auth.signInWithPopup(provider); }
function handleLogout() { auth.signOut(); showToast('បានចាកចេញ', 'info'); }

function toggleDarkModeSetting(el) {
    el.classList.toggle('active');
    toggleDarkMode();
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode'); const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme_mode', isDark ? 'dark' : 'light');
}

function applySettingsToggles() {
    if (localStorage.getItem('theme_mode') === 'dark') {
        const themeToggle = document.getElementById('settingThemeToggle');
        if (themeToggle) themeToggle.classList.add('active');
    }
    if (localStorage.getItem('setting_autoscroll') === 'true') {
        const scrollToggle = document.getElementById('settingScrollToggle');
        if (scrollToggle) scrollToggle.classList.add('active');
    }
}

function applyStoredTheme() { 
    if (localStorage.getItem('theme_mode') === 'dark') { 
        document.body.classList.add('dark-mode'); 
    } 
}

function toggleViewMode() {
    const grid = document.getElementById('songGrid');
    grid.classList.toggle('list-view');
    const isListView = grid.classList.contains('list-view');
    
    localStorage.setItem('app_view_mode', isListView ? 'list' : 'grid');
    
    const btn = document.getElementById('viewToggleBtn');
    if (btn) {
        btn.innerHTML = isListView 
            ? '<i class="fa-solid fa-table-cells-large"></i>' 
            : '<i class="fa-solid fa-list"></i>';
    }
}

function applyStoredViewMode() {
    if (localStorage.getItem('app_view_mode') === 'list') {
        const grid = document.getElementById('songGrid');
        if (grid) grid.classList.add('list-view');
        const btn = document.getElementById('viewToggleBtn');
        if (btn) btn.innerHTML = '<i class="fa-solid fa-table-cells-large"></i>';
    }
}


function escapeHtml(str) { if (!str) return ''; return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }






function transposeSingleChord(chord, steps) {
    if (!chord || steps === 0) return chord;
    
    let parts = chord.split('/');
    
    let transposedParts = parts.map(part => {
        let rootMatch = part.match(/^[A-G][#b]?/);
        if (!rootMatch) return part; 
        
        let root = rootMatch[0];
        let suffix = part.substring(root.length); 
        
        let index = keysSharp.indexOf(root);
        if (index === -1) index = keysFlat.indexOf(root);
        if (index === -1) return part; 
        
        let newIndex = (index + steps) % 12;
        if (newIndex < 0) newIndex += 12;
        
        return keysSharp[newIndex] + suffix;
    });

    return transposedParts.join('/');
}

function changeTranspose(step) {
    currentTransposeStep += step;
    
    let currentIndex = keysSharp.indexOf(baseSongKey);
    if (currentIndex === -1) currentIndex = keysFlat.indexOf(baseSongKey);
    
    if (currentIndex !== -1) {
        let newIndex = (currentIndex + currentTransposeStep) % 12;
        if (newIndex < 0) newIndex += 12;
        
        let newKey = keysSharp[newIndex]; 
        document.getElementById('transposeLabel').innerText = newKey; 
        updateCapoSuggestion(newKey); 
    } else {
        document.getElementById('transposeLabel').innerText = currentTransposeStep > 0 ? `+${currentTransposeStep}` : currentTransposeStep;
        updateCapoSuggestion(""); 
    }
    
    const song = currentFilteredSongs[currentFullscreenIndex];
    if (song && song.lyrics) {
        renderLyricsToHTML(song.lyrics);
    }
}

function updateCapoSuggestion(currentKey) {
    const capoEl = document.getElementById('capoSuggestion');
    if (!capoEl) return;
    
    if (!currentKey) {
        capoEl.style.display = 'none';
        return;
    }

    const suggestions = {
        "C#": "Capo 1 ➔ C",
        "Db": "Capo 1 ➔ C",
        "D#": "Capo 1 ➔ D  |  Capo 3 ➔ C",
        "Eb": "Capo 1 ➔ D  |  Capo 3 ➔ C",
        "F":  "Capo 1 ➔ E  |  Capo 5 ➔ C",
        "F#": "Capo 2 ➔ E  |  Capo 4 ➔ D",
        "Gb": "Capo 2 ➔ E  |  Capo 4 ➔ D",
        "G#": "Capo 1 ➔ G  |  Capo 4 ➔ E",
        "Ab": "Capo 1 ➔ G  |  Capo 4 ➔ E",
        "A#": "Capo 1 ➔ A  |  Capo 3 ➔ G",
        "Bb": "Capo 1 ➔ A  |  Capo 3 ➔ G",
        "B":  "Capo 2 ➔ A  |  Capo 4 ➔ G"
    };

    if (suggestions[currentKey]) {
        capoEl.innerHTML = `💡 ${suggestions[currentKey]}`;
        capoEl.style.display = 'block';
    } else {
        capoEl.style.display = 'none'; 
    }
}

function renderLyricsToHTML(rawText) {
    if(!rawText) return;
    const container = document.getElementById('fullScreenLyrics');
    const lines = rawText.split('\n');
    let html = '';

    lines.forEach(line => {
        if (line.trim() === '') {
            html += '<br>'; return;
        }
        
        if (/^(Intro|I\.|II\.|III\.|IV\.|Pre|R1\.|R2\.|Chorus|Bridge|Instr\.)/i.test(line)) {
            let lineHtml = `<div class="lyric-line" style="font-weight: 800; color: var(--primary); margin-top: 15px;">`;
            const parts = line.split(/\[(.*?)\]/g);
            if (parts.length === 1 && !line.includes('[')) {
                lineHtml += escapeHtml(line);
            } else {
                for(let i=0; i<parts.length; i++) {
                    if(i % 2 === 0) {
                        if(parts[i]) lineHtml += `<span class="lyric">${escapeHtml(parts[i])}</span>`;
                    } else {
                        let chord = transposeSingleChord(parts[i], currentTransposeStep);
                        let nextText = parts[i+1] || '\u00A0\u00A0';
                        lineHtml += `<span class="chord-word"><span class="chord">${escapeHtml(chord)}</span><span class="lyric">${escapeHtml(nextText)}</span></span>`;
                        i++;
                    }
                }
            }
            lineHtml += `</div>`;
            html += lineHtml;
            return;
        }

        let lineHtml = '<div class="lyric-line">';
        const parts = line.split(/\[(.*?)\]/g);

        if (parts.length === 1 && !line.includes('[')) { 
            lineHtml += `<span class="lyric">${escapeHtml(line)}</span>`;
        } else {
            for(let i=0; i<parts.length; i++) {
                if(i % 2 === 0) { 
                    if(parts[i]) {
                        if(i === 0) {
                            lineHtml += `<span class="chord-word"><span class="chord">&nbsp;</span><span class="lyric">${escapeHtml(parts[i])}</span></span>`;
                        } else {
                            lineHtml += `<span class="lyric">${escapeHtml(parts[i])}</span>`;
                        }
                    }
                } else { 
                    let chord = transposeSingleChord(parts[i], currentTransposeStep);
                    let nextText = parts[i+1] || '\u00A0\u00A0'; 
                    lineHtml += `<span class="chord-word"><span class="chord">${escapeHtml(chord)}</span><span class="lyric">${escapeHtml(nextText)}</span></span>`;
                    i++; 
                }
            }
        }
        lineHtml += '</div>';
        html += lineHtml;
    });

    container.innerHTML = html;
}

function updateFullScreenContent() {
    const song = currentFilteredSongs[currentFullscreenIndex]; if (!song) return;
    const modal = document.getElementById('fullScreenModal');
    
    document.getElementById('fullScreenTitle').innerText = song.title || 'រូបភាព';
    document.getElementById('pageCounter').innerText = `${currentFullscreenIndex + 1} / ${currentFilteredSongs.length}`;
    
    const imgEl = document.getElementById('fullScreenImg');
    const lyricsEl = document.getElementById('fullScreenLyrics');
    const transposeEl = document.getElementById('transposeControls');

    currentTransposeStep = 0; 
    
    let rawKey = song.songKey || "C";
    baseSongKey = rawKey.split(/[\s,/-]+/)[0].trim();
    if (!baseSongKey) baseSongKey = "C";
    document.getElementById('transposeLabel').innerText = baseSongKey;
    updateCapoSuggestion(baseSongKey);

    if (song.lyrics && song.lyrics.length > 5) {
        modal.classList.add('lyrics-mode');
        imgEl.style.display = 'none';
        lyricsEl.style.display = 'block';
        transposeEl.style.display = 'flex';
        renderLyricsToHTML(song.lyrics);
    } else {
        modal.classList.remove('lyrics-mode');
        imgEl.style.display = 'block';
        imgEl.src = song.imageUrl || 'https://via.placeholder.com/300x400?text=No+Image'; 
        lyricsEl.style.display = 'none';
        transposeEl.style.display = 'none';
    }

    currentRotation = 0; // <--- បន្ថែមបន្ទាត់នេះនៅទីនេះ
    resetZoomState();
}

function removeSongFromSetlist(songId, event) {
    if(event) event.stopPropagation();
    if (currentFilterType === 'SETLIST' && currentFilterValue && isEditor) {
        const week = currentFilterValue;
        if (confirm(`តើអ្នកពិតជាចង់ដកបទនេះចេញពី Setlist "${week}" មែនទេ?`)) {
            const index = globalSetlists[week].indexOf(songId);
            if (index !== -1) {
                globalSetlists[week].splice(index, 1);
                db.collection("public_settings").doc("setlists").set(globalSetlists, { merge: true });
                showToast('បានដកចេញពី Setlist រួចរាល់', 'info');
                renderSongs();
            }
        }
    }
}

function renderSongsListOnly() {
    const grid = document.getElementById('songGrid');
    if (!grid) return;

    if (!isDataLoaded) { grid.innerHTML = getSkeletonHTML(8); return; }
    if (currentFilteredSongs.length === 0) {
        grid.innerHTML = `<div class="empty-state">
            <i class="fa-solid fa-magnifying-glass empty-icon"></i>
            <div class="empty-title">រកមិនឃើញចម្រៀងឡើយ</div>
            <div class="empty-desc">សូមសាកល្បងស្វែងរកដោយប្រើពាក្យផ្សេង ឬពិនិត្យអក្ខរាវិរុទ្ធឡើងវិញ។</div>
        </div>`; return;
    }

    const isCustomPlaylist = currentFilterType === 'PLAYLIST' && currentFilterValue !== 'Favorite';
    const isSetlistAdmin = currentFilterType === 'SETLIST' && isEditor;
    const itemsToDisplay = currentFilteredSongs.slice(0, displayedItemCount);

    let html = itemsToDisplay.map((song) => {
        const inFav = (playlists['Favorite'] || []).includes(song.id);
        const keyHtml = song.songKey ? `<span class="song-key-badge">${escapeHtml(song.songKey)}</span>` : '';
        
        const playBtnHtml = song.mediaUrl ? `<button class="card-play-btn" onclick="playFloatingAudio('${song.id}', event)"><i class="fa-solid fa-play" style="margin-left:3px;"></i></button>` : '';
        
        let cardThumbnail = `<div class="song-text-preview" onclick="openFullScreenModal('${song.id}')">
                                ${getCardThumbnailHTML(song, false)}
                             </div>`;
                             
        if (song.imageUrl && song.imageUrl.length > 10) {
             cardThumbnail = `<img src="${song.imageUrl}" class="song-img" alt="${escapeHtml(song.title)}" loading="lazy" onclick="openFullScreenModal('${song.id}')">`;
        }

        return `
            <div class="song-card" id="song-card-${song.id}" ${(isCustomPlaylist || isSetlistAdmin) ? `draggable="true" ondragstart="handleDragStart(event, '${song.id}')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${song.id}')" ondragend="handleDragEnd(event)"` : ''}>
                <div class="song-img-container">
                    <button class="fav-img-btn ${inFav ? 'active' : ''}" onclick="toggleFavorite('${song.id}', event)">
                        <i class="${inFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                    </button>
                    ${playBtnHtml}
                    ${cardThumbnail}
                </div>
                
                <div class="song-info">
                    <div class="song-title-row">
                        <span class="song-title selectable-text" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</span>
                        <button class="btn-more-options" onclick="toggleSongMenu(event, '${song.id}')"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                        <div class="song-artist selectable-text">🎤 ${escapeHtml(song.artist || 'មិនស្គាល់')} ${keyHtml}</div>
                        <button class="btn-add-playlist-title" onclick="openPlaylistChooserModal('${song.id}')"><i class="fa-solid fa-plus"></i> Playlist</button>
                    </div>
                    <div class="card-dropdown" id="dropdown-${song.id}">
                        ${song.mediaUrl ? `<button class="card-dropdown-item" onclick="window.open('${song.mediaUrl}', '_blank')"><i class="fa-solid fa-play"></i> ស្តាប់ភ្លេង</button>` : ''}
                        <button class="card-dropdown-item" onclick="shareSongImage('${song.id}')"><i class="fa-solid fa-share-nodes"></i> Share ចម្រៀង</button>
                        <button class="card-dropdown-item" onclick="downloadSongAction('${song.id}')"><i class="fa-solid fa-download"></i> Save ទុក</button>
                        ${(currentFilterType === 'PLAYLIST' && currentFilterValue !== 'Favorite') ? `<button class="card-dropdown-item danger" onclick="removeSongFromPlaylist('${song.id}', event)"><i class="fa-solid fa-minus"></i> ដកចេញពី Playlist</button>` : ''}
                        ${(currentFilterType === 'SETLIST' && isEditor) ? `<button class="card-dropdown-item danger" onclick="removeSongFromSetlist('${song.id}', event)"><i class="fa-solid fa-minus"></i> ដកចេញពី Setlist</button>` : ''}
                        <button class="card-dropdown-item editor-only" onclick="openEditSongModal('${song.id}')"><i class="fa-solid fa-pen"></i> កែប្រែ (Edit)</button>
                        <button class="card-dropdown-item danger editor-only" onclick="deleteSong('${song.id}')"><i class="fa-solid fa-trash"></i> លុបចោល</button>
                    </div>
                </div>
            </div>`;
    }).join('');

    if (displayedItemCount < currentFilteredSongs.length) { html += `<div id="scrollSentinel" style="height: 1px; width: 100%; grid-column: 1 / -1;"></div>`; }
    grid.innerHTML = html; observeSentinel();
}



function removeSongFromPlaylist(songId, event) {
    if(event) event.stopPropagation();
    
    if (currentFilterType === 'PLAYLIST' && currentFilterValue) {
        const pName = currentFilterValue;
        if (confirm(`តើអ្នកពិតជាចង់ដកបទនេះចេញពី Playlist "${pName}" មែនទេ?`)) {
            const index = playlists[pName].indexOf(songId);
            if (index !== -1) {
                playlists[pName].splice(index, 1);
                localStorage.setItem('user_playlists', JSON.stringify(playlists));
                syncPlaylistsToCloud(); 
                renderSongs(); 
                showToast('បានដកចេញពី Playlist រួចរាល់', 'info');
            }
        }
    }
}

let baseLyricFontSize = 1.05;
function changeFontSize(step) {
    baseLyricFontSize += step;
    if (baseLyricFontSize < 0.5) baseLyricFontSize = 0.5;
    if (baseLyricFontSize > 3.0) baseLyricFontSize = 3.0;
    
    document.querySelectorAll('.lyric').forEach(el => {
        el.style.fontSize = baseLyricFontSize + 'rem';
    });
    document.querySelectorAll('.chord').forEach(el => {
        el.style.fontSize = (baseLyricFontSize * 0.85) + 'rem'; 
    });
}

let isPresentationMode = false;
function togglePresentationMode() {
    const modal = document.getElementById('fullScreenModal');
    isPresentationMode = !isPresentationMode;
    if (isPresentationMode) {
        modal.classList.add('presentation-mode');
        showToast('បានបើក Presentation Mode', 'info');
    } else {
        modal.classList.remove('presentation-mode');
        showToast('បានបិទ Presentation Mode', 'info');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const lyricsContainer = document.getElementById('fullScreenLyrics');
    let touchstartX = 0;
    let touchendX = 0;
    
    lyricsContainer.addEventListener('touchstart', e => {
        touchstartX = e.changedTouches[0].screenX;
    }, { passive: true });
    
    lyricsContainer.addEventListener('touchend', e => {
        touchendX = e.changedTouches[0].screenX;
        handleLyricsSwipe();
    }, { passive: true });
    
    function handleLyricsSwipe() {
        const swipeDist = touchendX - touchstartX;
        if (Math.abs(swipeDist) > 70) { 
            if (swipeDist < 0) slideFullScreen(1); 
            else slideFullScreen(-1); 
        }
    }
});


const originalCloseFullScreen = closeFullScreenModalDirect;
window.closeFullScreenModalDirect = function() {
    if (isMetronomePlaying) toggleMetronomePlay(); 
    document.getElementById('metronomePanel').style.display = 'none'; 
    originalCloseFullScreen();
}

const basicChords = {
    "C": [-1, 3, 2, 0, 1, 0], "Cm": [-1, 3, 5, 5, 4, 3], "C#": [-1, 4, 6, 6, 6, 4],
    "D": [-1, -1, 0, 2, 3, 2], "Dm": [-1, -1, 0, 2, 3, 1], "D#": [-1, 6, 8, 8, 8, 6],
    "E": [0, 2, 2, 1, 0, 0], "Em": [0, 2, 2, 0, 0, 0], "Eb": [-1, 6, 8, 8, 8, 6],
    "F": [1, 3, 3, 2, 1, 1], "Fm": [1, 3, 3, 1, 1, 1], "F#": [2, 4, 4, 3, 2, 2],
    "G": [3, 2, 0, 0, 0, 3], "Gm": [3, 5, 5, 3, 3, 3], "G#": [4, 6, 6, 5, 4, 4],
    "A": [-1, 0, 2, 2, 2, 0], "Am": [-1, 0, 2, 2, 1, 0], "Bb": [-1, 1, 3, 3, 3, 1],
    "B": [-1, 2, 4, 4, 4, 2], "Bm": [-1, 2, 4, 4, 3, 2]
};

document.addEventListener('click', function(e) {
    if(e.target.classList.contains('chord')) {
        let chordName = e.target.innerText.trim();
        showChordModal(chordName);
    }
            const homeSearchBox = document.querySelector('.home-search-bar-modern');
        const homeDropdown = document.getElementById('homeSearchDropdown');
        if (homeSearchBox && homeDropdown && !homeSearchBox.contains(e.target)) {
            homeDropdown.style.display = 'none';
        }

});

function closeChordModal() {
    document.getElementById('chordModal').classList.remove('active');
}

function showChordModal(chordName) {
    document.getElementById('chordModalTitle').innerText = chordName;
    document.getElementById('chordModal').classList.add('active');
    document.body.classList.add('no-scroll');
    drawChordDiagram(chordName);
}

function getBestChordMatch(chordName) {
    if (typeof fullChordLibrary !== 'undefined' && fullChordLibrary[chordName]) return fullChordLibrary[chordName];
    if (typeof basicChords !== 'undefined' && basicChords[chordName]) return basicChords[chordName];

    let noSlash = chordName.split('/')[0];
    if (typeof fullChordLibrary !== 'undefined' && fullChordLibrary[noSlash]) return fullChordLibrary[noSlash];
    if (typeof basicChords !== 'undefined' && basicChords[noSlash]) return basicChords[noSlash];

    let rootOnly = noSlash.replace(/add9|maj9|maj11|m11|dim7|dim|aug|sus2/g, '');
    if (typeof fullChordLibrary !== 'undefined' && fullChordLibrary[rootOnly]) return fullChordLibrary[rootOnly];
    if (typeof basicChords !== 'undefined' && basicChords[rootOnly]) return basicChords[rootOnly];
    
    let basicMatch = noSlash.match(/^[A-G][#b]?m?/);
    if (basicMatch) {
        let finalChord = basicMatch[0];
        if (typeof fullChordLibrary !== 'undefined' && fullChordLibrary[finalChord]) return fullChordLibrary[finalChord];
        if (typeof basicChords !== 'undefined' && basicChords[finalChord]) return basicChords[finalChord];
    }

    return null; 
}

function drawChordDiagram(chordName) {
    const canvas = document.getElementById('chordCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    let positions = getBestChordMatch(chordName);
    
    if (!positions) {
        ctx.fillStyle = "#64748b";
        ctx.font = "14px 'Kantumruy Pro', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("មិនមានទិន្នន័យ", canvas.width/2, canvas.height/2);
        return;
    }

    const startX = 25; const startY = 40; const stringSpacing = 20; const fretSpacing = 30;

    const stringsName = ['E', 'A', 'D', 'G', 'B', 'e'];
    ctx.font = "12px Arial"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center";
    for(let i=0; i<6; i++) {
        ctx.fillText(stringsName[i], startX + i * stringSpacing, startY - 20);
    }

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { 
        ctx.beginPath();
        ctx.moveTo(startX + i * stringSpacing, startY);
        ctx.lineTo(startX + i * stringSpacing, startY + 4 * fretSpacing);
        ctx.stroke();
    }
    
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + 5 * stringSpacing, startY);
    ctx.stroke();

    ctx.lineWidth = 1.5;
    for (let i = 1; i <= 4; i++) { 
        ctx.beginPath();
        ctx.moveTo(startX, startY + i * fretSpacing);
        ctx.lineTo(startX + 5 * stringSpacing, startY + i * fretSpacing);
        ctx.stroke();
    }

    for (let i = 0; i < 6; i++) {
        let fret = positions[i];
        let x = startX + i * stringSpacing;
        
        if (fret === -1) {
            ctx.fillStyle = "#ef4444"; ctx.font = "14px Arial";
            ctx.fillText("X", x, startY - 5);
        } else if (fret === 0) {
            ctx.strokeStyle = "#10b981"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, startY - 8, 4, 0, Math.PI*2); ctx.stroke();
        } else {
            let y = startY + (fret - 0.5) * fretSpacing; 
            let displayFret = fret;
            if(Math.max(...positions) > 4) {
                let minFret = Math.min(...positions.filter(p => p > 0));
                displayFret = fret - minFret + 1;
                y = startY + (displayFret - 0.5) * fretSpacing;
                
                if(i === 0 || (i > 0 && positions[i-1] <= 0)) {
                    ctx.fillStyle = "#3b82f6"; ctx.font = "bold 12px Arial";
                    ctx.fillText(minFret + "fr", startX - 15, startY + 0.5 * fretSpacing);
                }
            }
            
            ctx.fillStyle = "#2563eb";
            ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI*2); ctx.fill();
        }
    }
}










const fullChordLibrary = {
    "C": [-1, 3, 2, 0, 1, 0], "Cm": [-1, 3, 5, 5, 4, 3], "C7": [-1, 3, 2, 3, 1, 0], "Cm7": [-1, 3, 5, 3, 4, 3], "Cmaj7": [-1, 3, 2, 0, 0, 0], "Csus4": [-1, 3, 3, 0, 1, 0],
    "C#": [-1, 4, 6, 6, 6, 4], "C#m": [-1, 4, 6, 6, 5, 4], "C#7": [-1, 4, 6, 4, 6, 4], "C#m7": [-1, 4, 6, 4, 5, 4], "C#maj7": [-1, 4, 6, 5, 6, 4], "C#sus4": [-1, 4, 6, 6, 7, 4],
    "D": [-1, -1, 0, 2, 3, 2], "Dm": [-1, -1, 0, 2, 3, 1], "D7": [-1, -1, 0, 2, 1, 2], "Dm7": [-1, -1, 0, 2, 1, 1], "Dmaj7": [-1, -1, 0, 2, 2, 2], "Dsus4": [-1, -1, 0, 2, 3, 3],
    "Eb": [-1, 6, 8, 8, 8, 6], "Ebm": [-1, 6, 8, 8, 7, 6], "Eb7": [-1, 6, 8, 6, 8, 6], "Ebm7": [-1, 6, 8, 6, 7, 6], "Ebmaj7": [-1, 6, 8, 7, 8, 6], "Ebsus4": [-1, 6, 8, 8, 9, 6],
    "E": [0, 2, 2, 1, 0, 0], "Em": [0, 2, 2, 0, 0, 0], "E7": [0, 2, 0, 1, 0, 0], "Em7": [0, 2, 0, 0, 0, 0], "Emaj7": [0, 2, 1, 1, 0, 0], "Esus4": [0, 2, 2, 2, 0, 0],
    "F": [1, 3, 3, 2, 1, 1], "Fm": [1, 3, 3, 1, 1, 1], "F7": [1, 3, 1, 2, 1, 1], "Fm7": [1, 3, 1, 1, 1, 1], "Fmaj7": [-1, -1, 3, 2, 1, 0], "Fsus4": [1, 3, 3, 3, 1, 1],
    "F#": [2, 4, 4, 3, 2, 2], "F#m": [2, 4, 4, 2, 2, 2], "F#7": [2, 4, 2, 3, 2, 2], "F#m7": [2, 4, 2, 2, 2, 2], "F#maj7": [-1, -1, 4, 3, 2, 1], "F#sus4": [2, 4, 4, 4, 2, 2],
    "G": [3, 2, 0, 0, 0, 3], "Gm": [3, 5, 5, 3, 3, 3], "G7": [3, 2, 0, 0, 0, 1], "Gm7": [3, 5, 3, 3, 3, 3], "Gmaj7": [3, 2, 0, 0, 0, 2], "Gsus4": [3, 3, 0, 0, 1, 3],
    "G#": [4, 6, 6, 5, 4, 4], "G#m": [4, 6, 6, 4, 4, 4], "G#7": [4, 6, 4, 5, 4, 4], "G#m7": [4, 6, 4, 4, 4, 4], "G#maj7": [4, 6, 5, 5, 4, 4], "G#sus4": [4, 6, 6, 6, 4, 4],
    "A": [-1, 0, 2, 2, 2, 0], "Am": [-1, 0, 2, 2, 1, 0], "A7": [-1, 0, 2, 0, 2, 0], "Am7": [-1, 0, 2, 0, 1, 0], "Amaj7": [-1, 0, 2, 1, 2, 0], "Asus4": [-1, 0, 2, 2, 3, 0],
    "Bb": [-1, 1, 3, 3, 3, 1], "Bbm": [-1, 1, 3, 3, 2, 1], "Bb7": [-1, 1, 3, 1, 3, 1], "Bbm7": [-1, 1, 3, 1, 2, 1], "Bbmaj7": [-1, 1, 3, 2, 3, 1], "Bbsus4": [-1, 1, 3, 3, 4, 1],
    "B": [-1, 2, 4, 4, 4, 2], "Bm": [-1, 2, 4, 4, 3, 2], "B7": [-1, 2, 1, 2, 0, 2], "Bm7": [-1, 2, 4, 2, 3, 2], "Bmaj7": [-1, 2, 4, 3, 4, 2], "Bsus4": [-1, 2, 4, 4, 5, 2]
};

function switchTunerTab(tabName) {
    const tunerBtn = document.getElementById('tabBtnTuner');
    const libBtn = document.getElementById('tabBtnLibrary');
    const tunerContent = document.getElementById('tunerTabContent');
    const libContent = document.getElementById('libraryTabContent');

    if (tabName === 'tuner') {
        tunerBtn.classList.add('active');
        libBtn.classList.remove('active');
        tunerContent.style.display = 'flex';
        libContent.style.display = 'none';
    } else {
        libBtn.classList.add('active');
        tunerBtn.classList.remove('active');
        tunerContent.style.display = 'none';
        libContent.style.display = 'flex';
        
        if (isTunerActive) toggleTunerAction();
        
        updateLibraryChord();
    }
}

function updateLibraryChord() {
    const root = document.getElementById('chordRootSelect').value;
    const type = document.getElementById('chordTypeSelect').value;
    const chordName = root + type;
    
    document.getElementById('libraryChordNameDisplay').innerText = chordName;
    drawCustomChordDiagram(chordName, 'libraryChordCanvas');
}

function drawCustomChordDiagram(chordName, canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    let positions = fullChordLibrary[chordName];
    
    if (!positions) {
        ctx.fillStyle = "#64748b";
        ctx.font = "14px 'Kantumruy Pro', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("មិនមានទិន្នន័យ", canvas.width/2, canvas.height/2);
        return;
    }

    const startX = 30; const startY = 40; const stringSpacing = 20; const fretSpacing = 30;

    const stringsName = ['E', 'A', 'D', 'G', 'B', 'e'];
    ctx.font = "13px Arial"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center";
    for(let i=0; i<6; i++) {
        ctx.fillText(stringsName[i], startX + i * stringSpacing, startY - 20);
    }

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { 
        ctx.beginPath(); ctx.moveTo(startX + i * stringSpacing, startY); ctx.lineTo(startX + i * stringSpacing, startY + 4 * fretSpacing); ctx.stroke();
    }
    
    ctx.lineWidth = 4; 
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(startX + 5 * stringSpacing, startY); ctx.stroke();

    ctx.lineWidth = 1.5;
    for (let i = 1; i <= 4; i++) { 
        ctx.beginPath(); ctx.moveTo(startX, startY + i * fretSpacing); ctx.lineTo(startX + 5 * stringSpacing, startY + i * fretSpacing); ctx.stroke();
    }

    for (let i = 0; i < 6; i++) {
        let fret = positions[i];
        let x = startX + i * stringSpacing;
        
        if (fret === -1) {
            ctx.fillStyle = "#ef4444"; ctx.font = "bold 15px Arial"; ctx.fillText("X", x, startY - 5);
        } else if (fret === 0) {
            ctx.strokeStyle = "#10b981"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, startY - 8, 4.5, 0, Math.PI*2); ctx.stroke();
        } else {
            let displayFret = fret;
            let y = startY + (displayFret - 0.5) * fretSpacing;
            
            if(Math.max(...positions) > 4) {
                let minFret = Math.min(...positions.filter(p => p > 0));
                displayFret = fret - minFret + 1;
                y = startY + (displayFret - 0.5) * fretSpacing;
                
                if(i === 0 || (i > 0 && positions[i-1] <= 0)) {
                    ctx.fillStyle = "#3b82f6"; ctx.font = "bold 13px Arial";
                    ctx.fillText(minFret + "fr", startX - 20, startY + 0.5 * fretSpacing);
                }
            }
            
            ctx.fillStyle = "#2563eb";
            ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI*2); ctx.fill();
        }
    }
}

function toggleProfilePopup(event) {
    if(event) event.stopPropagation();
    const popup = document.getElementById('profilePopup');
    const profileBtn = document.getElementById('homeProfileBtn');
    
    if(popup) {
        popup.classList.toggle('show');
        
        if(popup.classList.contains('show')) {
            if(profileBtn) profileBtn.classList.add('active'); 
            renderProfilePopup();
        } else {
            if(profileBtn) profileBtn.classList.remove('active'); 
        }
    }
}

function renderProfilePopup() {
    const content = document.getElementById('profilePopupContent');
    if (!content) return;

    if (currentUser) {
        let roleHtml = isAdmin ? '👑 Admin' : (isEditor ? '✏️ Editor' : '👤 សមាជិក');
        content.innerHTML = `
            <div class="profile-popup-header">
                <img src="${currentUser.photoURL || 'https://via.placeholder.com/100'}" class="profile-popup-avatar" alt="User">
                <div style="overflow: hidden;">
                    <div class="profile-popup-name">${escapeHtml(currentUser.displayName || 'អ្នកប្រើប្រាស់')}</div>
                    <div class="profile-popup-email">${escapeHtml(currentUser.email || '')}</div>
                    <div class="profile-popup-role">${roleHtml}</div>
                </div>
            </div>
            <button class="profile-popup-btn" onclick="switchTab('settings'); toggleProfilePopup();"><i class="fa-solid fa-gear"></i> ចូលទៅការកំណត់ (Settings)</button>
            <div style="height: 8px;"></div>
            <button class="profile-popup-btn danger" onclick="handleLogout(); toggleProfilePopup();"><i class="fa-solid fa-right-from-bracket"></i> ចាកចេញ (Logout)</button>
        `;
    } else {
        content.innerHTML = `
            <div style="text-align: center; padding: 10px 0 15px 0;">
                <i class="fa-regular fa-circle-user" style="font-size: 3.5rem; color: var(--text-muted); margin-bottom: 10px;"></i>
                <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">អ្នកមិនទាន់បាន Login នៅឡើយទេ</div>
            </div>
            <button class="profile-popup-btn" style="background: var(--primary); color: white;" onclick="handleGoogleLogin(); toggleProfilePopup();"><i class="fa-brands fa-google"></i> Login ចូលប្រើប្រាស់</button>
        `;
    }
}


const worshipVerses = [
    { text: "«គួរឱ្យជីវិតទាំងឡាយដែលមានដង្ហើម បានសរសើរដល់ព្រះយ៉េហូវ៉ាចុះ។»", ref: "ទំនុកតម្កើង ១៥០:៦" },
    { text: "«មកចុះ យើងនឹងច្រៀងថ្វាយព្រះយេហូវ៉ា ចូរយើងឡើងសំឡេងដោយអំណរដល់ថ្មដានៃសេចក្ដីសង្គ្រោះរបស់យើង»", ref: "ទំនុកតម្កើង ៩៥:១" },
    { text: "«ចូរគោរពប្រតិបត្តិដល់ព្រះយេហូវ៉ា ដោយអរសប្បាយឲ្យចូលមកនៅចំពោះទ្រង់ ដោយច្រៀងចំរៀងចុះ»", ref: "ទំនុកតម្កើង ១០០:២" },
    { text: "«ចូរច្រៀងបទថ្មីថ្វាយព្រះយេហូវ៉ាចូរឲ្យជនទាំងឡាយ នៅផែនដីច្រៀងថ្វាយព្រះយេហូវ៉ាចុះ»", ref: "ទំនុកតម្កើង ៩៦:១" },
    { text: "«ចូរឲ្យព្រះបន្ទូលនៃព្រះគ្រីស្ទ បានសណ្ឋិតនៅក្នុងអ្នករាល់គ្នាជាបរិបូរ ដោយប្រាជ្ញាគ្រប់យ៉ាង ទាំងបង្រៀន ហើយទូន្មានគ្នា ដោយនូវទំនុកដំកើង ទំនុកបរិសុទ្ធ នឹងចំរៀងខាងឯវិញ្ញាណ ទាំងច្រៀងក្នុងចិត្តថ្វាយព្រះ ដោយព្រះគុណ»", ref: "កូលុស ៣:១៦" },
    { text: "«ឱព្រះអម្ចាស់ ជាព្រះនៃទូលបង្គំអើយ ទូលបង្គំនឹងសរសើរទ្រង់ឲ្យអស់ពីចិត្ត ហើយនឹងលើកដំកើងព្រះនាមទ្រង់ជាដរាបតទៅ»", ref: "ទំនុកតម្កើង ៨៦:១២" },
    { text: "«ខ្ញុំនឹងលើកសរសើរដល់ព្រះយេហូវ៉ាគ្រប់ ពេលវេលាសេចក្ដីសរសើរពីទ្រង់ នឹងនៅក្នុងមាត់ខ្ញុំជានិច្ច»", ref: "ទំនុកតម្កើង ៣៤:១" },
    { text: "«សូមអនុញ្ញាតឲ្យបបូរមាត់ទូលបង្គំ បានពោលពាក្យសរសើរ ដ្បិតទ្រង់បង្រៀនអស់ទាំងបញ្ញត្តរបស់ទ្រង់ដល់ទូលបង្គំ»", ref: "ទំនុកតម្កើង ១១៩:១៧១" }
];

function displayRandomVerse() {
    const verseTextEl = document.getElementById('dailyVerseText');
    const verseRefEl = document.getElementById('dailyVerseRef');
    
    if (verseTextEl && verseRefEl) {
        const randomIndex = Math.floor(Math.random() * worshipVerses.length);
        const verse = worshipVerses[randomIndex];
        verseTextEl.innerText = verse.text;
        verseRefEl.innerText = verse.ref;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    displayRandomVerse();
});

let isChordsHidden = localStorage.getItem('setting_hide_chords') === 'true';

function toggleChordsVisibility() {
    isChordsHidden = !isChordsHidden;
    localStorage.setItem('setting_hide_chords', isChordsHidden ? 'true' : 'false');
    applyChordsVisibility();
    vibratePhone(30); 
}

function applyChordsVisibility() {
    const lyricsContainer = document.getElementById('fullScreenLyrics');
    const toggleBtn = document.getElementById('toggleChordsBtn');
    const toggleIcon = document.getElementById('toggleChordsIcon');
    const toggleText = document.getElementById('toggleChordsText');
    
    if (!lyricsContainer || !toggleBtn) return;

    if (isChordsHidden) {
        lyricsContainer.classList.add('lyrics-chords-hidden');
        toggleBtn.style.color = 'var(--danger)';
        toggleIcon.className = 'fa-solid fa-e';
        toggleText.innerText = 'បើក';
    } else {
        lyricsContainer.classList.remove('lyrics-chords-hidden');
        toggleBtn.style.color = 'var(--text)';
        toggleIcon.className = 'fa-solid fa-eye-slash';
        toggleText.innerText = 'បិទ';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    applyChordsVisibility();
});

function playStringTone(noteName, frequency, btnElement) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'triangle'; 
    osc.frequency.value = frequency;

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5);

    osc.start();
    osc.stop(audioCtx.currentTime + 1.5);

    document.querySelectorAll('.string-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    setTimeout(() => {
        if (btnElement) btnElement.classList.remove('active');
    }, 400);

    showToast(`កំពុងចាក់សំឡេងខ្សែ: ${noteName}`, 'info');
}

// ====================================================
// មុខងារ AUTO-SCROLL (ແບບស្លាយចេញ/ចូល មិនបាំងអត្ថបទ)
// ====================================================

let scrollInterval = null;
let currentScrollSpeed = 1;
let isAutoScrollExpanded = false;

function setupAutoScrollButton() {
    if (document.getElementById('autoScrollFloatingBar')) return;

    // បញ្ចូល Style សម្រាប់បែប Slide Animation
    const style = document.createElement('style');
    style.innerHTML = `
        .autoscroll-bar {
            position: absolute;
            bottom: calc(85px + env(safe-area-inset-bottom));
            right: 16px;
            background: rgba(15, 23, 42, 0.9);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 30px;
            padding: 4px;
            display: none;
            align-items: center;
            gap: 6px;
            z-index: 3050;
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .autoscroll-main-btn {
            background: #10b981;
            border: none;
            color: white;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1rem;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
            transition: 0.2s;
            flex-shrink: 0;
        }
        .autoscroll-main-btn.playing {
            background: #ef4444;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        }
        .autoscroll-controls-panel {
            display: flex;
            align-items: center;
            gap: 6px;
            max-width: 0;
            overflow: hidden;
            opacity: 0;
            transition: max-width 0.3s ease, opacity 0.2s ease;
            white-space: nowrap;
        }
        .autoscroll-bar.expanded .autoscroll-controls-panel {
            max-width: 150px;
            opacity: 1;
        }
        .autoscroll-sub-btn {
            background: rgba(255, 255, 255, 0.15);
            border: none;
            color: #ffffff;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            transition: 0.2s;
        }
        .autoscroll-sub-btn:active {
            transform: scale(0.9);
            background: var(--primary);
        }
        .autoscroll-speed-display {
            color: #ffffff;
            font-size: 0.75rem;
            font-weight: 700;
            min-width: 32px;
            text-align: center;
        }
    `;
    document.head.appendChild(style);

    // បង្កើត Container ຕົ້ນមេ
    const bar = document.createElement('div');
    bar.id = 'autoScrollFloatingBar';
    bar.className = 'autoscroll-bar';

    // ប៊ូតុងគោល (ពេលចុចគឺ Play/Pause បើកពង្រីក)
    const mainBtn = document.createElement('button');
    mainBtn.className = 'autoscroll-main-btn';
    mainBtn.id = 'scrollTogglePlayBtn';
    mainBtn.innerHTML = 'A';
    mainBtn.onclick = (e) => {
        e.stopPropagation();
        toggleExpandOrPlay();
    };

    // ផ្ទាំងបញ្ជាល្បឿនដែលលាក់/បង្ហាញ (Slide Panel)
    const panel = document.createElement('div');
    panel.className = 'autoscroll-controls-panel';

    const btnMinus = document.createElement('button');
    btnMinus.className = 'autoscroll-sub-btn';
    btnMinus.innerText = '-';
    btnMinus.onclick = (e) => { e.stopPropagation(); adjustScrollSpeed(-0.2); };

    const speedLabel = document.createElement('span');
    speedLabel.className = 'autoscroll-speed-display';
    speedLabel.id = 'scrollSpeedText';
    speedLabel.innerText = '1.0x';

    const btnPlus = document.createElement('button');
    btnPlus.className = 'autoscroll-sub-btn';
    btnPlus.innerText = '+';
    btnPlus.onclick = (e) => { e.stopPropagation(); adjustScrollSpeed(0.2); };

    panel.appendChild(btnMinus);
    panel.appendChild(speedLabel);
    panel.appendChild(btnPlus);

    bar.appendChild(mainBtn);
    bar.appendChild(panel);

    // ពេលចុចលើកន្លែងទទេ ឬប៊ូតុង ឱ្យវាបិទ Panel វិញបើកំពុងបើក
    document.addEventListener('click', (e) => {
        if (isAutoScrollExpanded && !bar.contains(e.target)) {
            collapsePanel();
        }
    });

    const modal = document.getElementById('fullScreenModal');
    if (modal) modal.appendChild(bar);
}

// គ្រប់គ្រងការចុចលើប៊ូតុងមេ
function toggleExpandOrPlay() {
    const bar = document.getElementById('autoScrollFloatingBar');
    
    if (!isAutoScrollExpanded) {
        // បើកឱ្យវាពង្រីកបង្ហាញផ្ទាំង -/+
        bar.classList.add('expanded');
        isAutoScrollExpanded = true;
    } else {
        // បើវាបើកស្រាប់ ចុចលើវាគឺចាប់ផ្តើម Play/Pause
        executePlayPause();
    }
}

function collapsePanel() {
    const bar = document.getElementById('autoScrollFloatingBar');
    if (bar) bar.classList.remove('expanded');
    isAutoScrollExpanded = false;
}

function executePlayPause() {
    const mainBtn = document.getElementById('scrollTogglePlayBtn');
    const lyricsContainer = document.getElementById('fullScreenLyrics');

    // បើកំពុងតែរំកិលស្រាប់ (មាន autoScrollFrameReq) យើងនឹងបញ្ឈប់វា
    if (autoScrollFrameReq) {
        stopAutoScroll();
        if (mainBtn) {
            mainBtn.classList.remove('playing');
            mainBtn.innerHTML = 'A';
        }
        showToast("បានផ្អាក Auto-Scroll", "info");
    } else {
        if (!lyricsContainer) return;

        // បង្កើតមុខងារតូចមួយសម្រាប់ Loop ការរំកិល
        function scrollStep() {
            lyricsContainer.scrollTop += currentScrollSpeed;
            
            // ឆែកមើលថាដល់ខាងក្រោមឬនៅ (ដក 2px ដើម្បីចៀសវាងការគណនាខុសបន្តិចបន្តួច)
            if (lyricsContainer.scrollTop + lyricsContainer.clientHeight >= lyricsContainer.scrollHeight - 2) {
                stopAutoScroll();
                if (mainBtn) {
                    mainBtn.classList.remove('playing');
                    mainBtn.innerHTML = 'A';
                }
            } else {
                // ហៅមុខងារនេះម្តងទៀតនៅ Frame បន្ទាប់
                autoScrollFrameReq = requestAnimationFrame(scrollStep);
            }
        }

        // ចាប់ផ្តើមការរំកិល
        autoScrollFrameReq = requestAnimationFrame(scrollStep);

        if (mainBtn) {
            mainBtn.classList.add('playing');
            mainBtn.innerHTML = 'A';
        }
        showToast("កំពុងរំកិលស្វ័យប្រវត្តិ...", "success");
    }
    collapsePanel();
}

function stopAutoScroll() {
    if (autoScrollFrameReq) {
        cancelAnimationFrame(autoScrollFrameReq);
        autoScrollFrameReq = null;
    }
    // ទុកកូដនេះដើម្បីការពារក្រែងលោនៅសល់ការរំកិលចាស់
    if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
    }
}


function adjustScrollSpeed(delta) {
    currentScrollSpeed = Math.round((currentScrollSpeed + delta) * 10) / 10;
    if (currentScrollSpeed < 0.4) currentScrollSpeed = 0.4;
    if (currentScrollSpeed > 3.0) currentScrollSpeed = 3.0;

    const label = document.getElementById('scrollSpeedText');
    if (label) label.innerText = currentScrollSpeed.toFixed(1) + 'x';
}

function checkAndDisplayAutoScrollBar() {
    setupAutoScrollButton();
    const bar = document.getElementById('autoScrollFloatingBar');
    const song = currentFilteredSongs[currentFullscreenIndex];

    if (bar && song && song.lyrics && song.lyrics.length > 5) {
        bar.style.display = 'flex';
    } else if (bar) {
        bar.style.display = 'none';
        stopAutoScroll();
        collapsePanel();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupAutoScrollButton();
});

const nativeUpdateFullScreen = updateFullScreenContent;
updateFullScreenContent = function() {
    stopAutoScroll();
    collapsePanel();
    const mainBtn = document.getElementById('scrollTogglePlayBtn');
    if (mainBtn) {
        mainBtn.classList.remove('playing');
        mainBtn.innerHTML = 'A';
    }
    nativeUpdateFullScreen();
    checkAndDisplayAutoScrollBar();
};

const nativeCloseFS = closeFullScreenModalDirect;
closeFullScreenModalDirect = function() {
    stopAutoScroll();
    collapsePanel();
    const bar = document.getElementById('autoScrollFloatingBar');
    if (bar) bar.style.display = 'none';
    nativeCloseFS();
};

// បិទបើកកន្លែង Search នៅទំព័រចម្រៀង (YouTube Style)
function toggleSongsSearchMode(isActive) {
    const normalHeader = document.getElementById('songsNormalHeader');
    const searchHeader = document.getElementById('songsSearchHeader');
    const searchInput = document.getElementById('searchInput');

    if (isActive) {
        normalHeader.style.display = 'none';
        searchHeader.style.display = 'flex';
        setTimeout(() => searchInput.focus(), 100);
    } else {
        normalHeader.style.display = 'flex';
        searchHeader.style.display = 'none';
        clearSearchInput();
    }
}

// មុខងារ Search ដោយឡែកសម្រាប់ Home Page
function handleHomeSearch() {
    const input = document.getElementById('homeSearchInput');
    const clearBtn = document.getElementById('clearHomeSearchBtn');
    const dropdown = document.getElementById('homeSearchDropdown');
    const rawVal = input.value;
    
    if (rawVal.trim().length > 0) clearBtn.style.display = 'block';
    else clearBtn.style.display = 'none';

    const rawTerms = rawVal.split(/\s+/).filter(t => t.length > 0);
    const searchTerms = rawTerms.map(t => cleanKhmerChars(t));

    if (searchTerms.length === 0) { dropdown.style.display = 'none'; return; }

    let matches = songsList.filter(s => {
        const fullText = cleanKhmerChars((s.title || '') + ' ' + (s.artist || '')).replace(/\s+/g, '');
        return searchTerms.every(term => fullText.includes(term.replace(/\s+/g, '')));
    });

    matches = matches.slice(0, 15); // បង្ហាញ ១៥ បទ

    if (matches.length > 0) {
        dropdown.innerHTML = matches.map(s => `
            <div class="search-dropdown-item" onclick="openFullScreenModal('${s.id}'); clearHomeSearch();">
                <div style="display:flex; align-items:center; gap: 10px;">
                    <div style="width:35px; height:35px; border-radius:8px; overflow:hidden; background:var(--bg); flex-shrink:0;">
                        ${s.imageUrl && s.imageUrl.length > 10 ? `<img src="${s.imageUrl}" style="width:100%; height:100%; object-fit:cover;">` : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--primary); color:white;"><i class="fa-solid fa-music"></i></div>`}
                    </div>
                    <div>
                        <div class="search-dropdown-title">${escapeHtml(s.title)}</div>
                        <div class="search-dropdown-artist">🎤 ${escapeHtml(s.artist || 'មិនស្គាល់')}</div>
                    </div>
                </div>
                <i class="fa-solid fa-play" style="font-size: 0.9rem; color: var(--primary);"></i>
            </div>
        `).join('');
        dropdown.style.display = 'block';
    } else {
        dropdown.innerHTML = '<div class="search-dropdown-item" style="color:var(--text-muted); justify-content:center;">រកមិនឃើញចម្រៀងឡើយ</div>';
        dropdown.style.display = 'block';
    }
}

function clearHomeSearch() {
    document.getElementById('homeSearchInput').value = '';
    document.getElementById('clearHomeSearchBtn').style.display = 'none';
    document.getElementById('homeSearchDropdown').style.display = 'none';
}

document.addEventListener('keydown', (e) => {
    // មិនត្រូវដំណើរការ Shortcut ទេ បើសិនជាអ្នកប្រើប្រាស់កំពុងพิมพ์ក្នុង ô ស្វែងរក ឬ Textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
    }

    // ១. ចុចปุ่ม Space ដើម្បី Play/Pause អូឌីយ៉ូ
    if (e.code === 'Space') {
        e.preventDefault(); // ការពារកុំឱ្យទំព័ររំកិលចុះក្រោមពេលចុច Space
        toggleApplePlayPause();
    }

    // ២. ចុចព្រួញស្តាំ (ArrowRight) ដើម្បីទៅបទបន្ទាប់
    if (e.code === 'ArrowRight') {
        playNextSong();
    }

    // ៣. ចុចព្រួញឆ្វេង (ArrowLeft) ដើម្បីថយទៅបទមុន
    if (e.code === 'ArrowLeft') {
        playPrevSong();
    }

    // ៤. ចុចปุ่ม Escape (Esc) ដើម្បីបិទ Fullscreen Modal ឬ Modal ផ្សេងៗ
    if (e.code === 'Escape') {
        const fullScreenModal = document.getElementById('fullScreenModal');
        const appleFullPlayer = document.getElementById('appleFullPlayer');
        
        if (fullScreenModal && fullScreenModal.classList.contains('active')) {
            closeFullScreenModalDirect();
        } else if (appleFullPlayer && appleFullPlayer.classList.contains('active')) {
            closeAppleFullScreenPlayer();
        } else {
            // បិទ Modal ទូទៅផ្សេងទៀត
            document.querySelectorAll('.modal.active').forEach(modal => {
                modal.classList.remove('active');
                document.body.classList.remove('no-scroll');
            });
        }
    }
});

// =========================================
// មុខងារ Swipe អូសឆ្វេង/ស្តាំ ដើម្បីប្តូរ Tab លើទូរស័ព្ទ
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;

    // លំដាប់ Tab ខាងក្រោម (ពីឆ្វេងទៅស្តាំ)
    const tabOrder = ['home', 'songs', 'albums', 'settings'];

    mainContent.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    mainContent.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipeGesture(e.target);
    }, { passive: true });

    function handleSwipeGesture(target) {
        // បើកំពុងបើកមើលរូប Fullscreen ឬកំពុងអូសលើកន្លែងដែលអូសផ្តេកស្រាប់ (Slider) មិនឱ្យប្តូរ Tab ទេ
        if (document.getElementById('fullScreenModal')?.classList.contains('active') ||
            target.closest('.horizontal-scroll-modern') || 
            target.closest('.filter-chips') || 
            target.closest('input') || 
            target.closest('textarea')) {
            return;
        }

        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;

        // កំណត់ថាជាការអូសផ្តេកពិតប្រាកដ បើចម្ងាយអូសផ្តេកវែងជាងបញ្ឈរ និងអូសលើសពី ៨០px
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 80) {
            
            // រកមើលថាបច្ចុប្បន្នយើងកំពុងនៅ Tab ណា
            const currentActiveView = document.querySelector('.app-view.active');
            if (!currentActiveView) return;

            // កាត់យកតែឈ្មោះដើម ឧ. viewHome ទៅជា home
            const currentTabId = currentActiveView.id.replace('view', '').toLowerCase();
            const currentIndex = tabOrder.indexOf(currentTabId);

            // បើមិនមែនជា Main Tab ទាំង៤ ទេ មិនដំណើរការឡើយ
            if (currentIndex === -1) return;

            if (diffX < 0) {
                // អូសទៅឆ្វេង (Swipe Left) => ប្តូរទៅ Tab ខាងស្តាំបន្ទាប់
                if (currentIndex < tabOrder.length - 1) {
                    switchTab(tabOrder[currentIndex + 1]);
                }
            } else {
                // អូសទៅស្តាំ (Swipe Right) => ត្រឡប់មក Tab ខាងឆ្វេងមុន
                if (currentIndex > 0) {
                    switchTab(tabOrder[currentIndex - 1]);
                }
            }
        }
    }
});
