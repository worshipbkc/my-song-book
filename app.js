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

// អថេរទូទៅ
let currentUser = null;
let isEditor = false;
let isAdmin = false;
let songsList = [];          
let customAlbums = ['ទំនុកដំកើង', 'ទំនុកខ្មែរបរិសុទ្ធ'];
let playlists = JSON.parse(localStorage.getItem('user_playlists') || '{}');
let globalSetlists = {};

function listenToGlobalSetlists() {
    db.collection("public_settings").doc("setlists").onSnapshot((doc) => {
        if (doc.exists) {
            globalSetlists = doc.data();
        } else {
            globalSetlists = {};
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
    const header = document.getElementById('mainAppHeader');
    const greeting = document.querySelector('.minimal-greeting');
    const controls = document.querySelector('.controls');
    const filterChips = document.querySelector('.filter-chips');
    const backBtn = document.getElementById('backButton');
    const iconCircle = document.querySelector('.section-title .icon-circle');

    if (isFiltered) {
        if (header) header.style.display = 'none';
        if (greeting) greeting.style.display = 'none';
        if (controls) controls.style.display = 'none';
        if (filterChips) filterChips.style.display = 'none';
        if (iconCircle) iconCircle.style.display = 'none';
        if (backBtn) backBtn.style.display = 'block';
    } else {
        if (header) header.style.display = 'flex';
        if (greeting) greeting.style.display = 'block';
        if (controls) controls.style.display = 'flex';
        if (filterChips) filterChips.style.display = 'flex';
        if (iconCircle) iconCircle.style.display = 'flex';
        if (backBtn) backBtn.style.display = 'none';
    }
}

function goBackToMain() {
    const prevFilterType = currentFilterType;
    resetFilters();
    if (prevFilterType === 'ALBUM') {
        switchTab('albums');
    } else if (prevFilterType === 'PLAYLIST') {
        switchTab('playlists');
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
    
    // បន្ថែមកូដនេះ ដើម្បីបិទ Profile Popup ពេលចុចចេញក្រៅ
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

    if (tabName === 'home') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewHome').classList.add('active');
        document.getElementById('navHomeBtn').classList.add('active');
        renderHomeView();
    } else if (tabName === 'songs') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewSongs').classList.add('active');
        document.getElementById('navSongsBtn').classList.add('active');
        renderSongs();
    } else if (tabName === 'albums') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewAlbums').classList.add('active');
        document.getElementById('navAlbumsBtn').classList.add('active');
        renderAlbumsView();
    } else if (tabName === 'playlists') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewPlaylists').classList.add('active');
        document.getElementById('navPlaylistsBtn').classList.add('active');
        renderPlaylistsView();
    } else if (tabName === 'settings') {
        if (mainHeader) mainHeader.style.display = 'none';
        document.getElementById('viewSettings').classList.add('active');
        document.getElementById('navProfileBtn').classList.add('active');
        closeNotificationsSubView();
        renderSettingsView();
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

function fetchAllSongsWithProgress() {
    const fetchBtn = document.getElementById('fetchAllBtn');
    const fetchIcon = document.getElementById('fetchIcon');
    const percentLabel = document.getElementById('progressPercent');

    fetchBtn.disabled = true;
    percentLabel.style.display = 'block';
    percentLabel.innerText = '0%';
    fetchIcon.className = 'fa-solid fa-spinner fa-spin';

    let progress = 0;
    const interval = setInterval(() => {
        progress += 20;
        if (progress > 80) progress = 80;
        percentLabel.innerText = progress + '%';
    }, 100);

    db.collection("songs").orderBy("createdAt", "desc").get().then((snapshot) => {
        clearInterval(interval);
        percentLabel.innerText = '100%';
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

        setTimeout(() => markFetchCompleted(), 300);
        vibratePhone(100);
        showToast('ទាញយកដោយជោគជ័យ', 'success');
    }).catch(err => {
        clearInterval(interval);
        fetchBtn.disabled = false;
        percentLabel.style.display = 'none';
        fetchIcon.className = 'fa-solid fa-cloud-arrow-down';
        showToast('បរាជ័យក្នុងការទាញយកទិន្នន័យ', 'error');
    });
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
        // ឱ្យ Admin រៀបចំ Setlist ទើបមិន Error
        checkAndResetMonthlySetlists();
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

    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${now.getMonth()}`;
    const lastMonthStr = localStorage.getItem('admin_last_setlist_month');
    
    // បើនៅខែដដែល ហើយមានទិន្នន័យខ្លះហើយ មិនបាច់ Update ទៀតទេ
    if (lastMonthStr === currentMonthStr && Object.keys(globalSetlists).length > 0) return;

    let hasChanges = false;
    let newSetlists = { ...globalSetlists };

    if (lastMonthStr && lastMonthStr !== currentMonthStr) {
        ['សប្តាហ៍ទី១', 'សប្តាហ៍ទី២', 'សប្តាហ៍ទី៣', 'សប្តាហ៍ទី៤', 'សប្តាហ៍ទី៥'].forEach(week => {
            newSetlists[week] = [];
            hasChanges = true;
        });
    }

    const totalSundays = getSundaysInCurrentMonth();
    for (let i = 1; i <= totalSundays; i++) {
        const weekName = `សប្តាហ៍ទី${i}`;
        if (!newSetlists[weekName]) {
            newSetlists[weekName] = [];
            hasChanges = true;
        }
    }

    if (hasChanges) {
        db.collection("public_settings").doc("setlists").set(newSetlists, { merge: true }).catch(err => {
            console.error("Setlist update error:", err);
            showToast("បញ្ហា Firebase Rules: សូមពិនិត្យ Database Rules", "error");
        });
    }
    
    localStorage.setItem('admin_last_setlist_month', currentMonthStr);
}

function renderHomeView() {
    const continueList = document.getElementById('homeContinueList');
    const setlistList = document.getElementById('homeSetlistList');
    
    if (!songsList || songsList.length === 0) {
        if (continueList) continueList.innerHTML = '<div class="home-empty-inline">កំពុងទាញយកបទចម្រៀង...</div>';
        if (setlistList) setlistList.innerHTML = '<div class="home-empty-inline">សូមរង់ចាំបន្តិច...</div>';
        return;
    }

    // ១. រៀបចំបញ្ជី "ប្រវត្តិមើល" (Continue Reading)
    const history = getRecentHistorySongs(4);
    if (continueList) {
        const source = history.length ? history : songsList.slice(0, 4);
        continueList.innerHTML = source.map(song => `
            <button class="home-mini-card" onclick="openFullScreenModal('${song.id}')">
                <div class="home-mini-cover">${getCardThumbnailHTML(song, true)}</div>
                <div class="home-mini-info"><strong>${escapeHtml(song.title || 'បទចម្រៀង')}</strong><span>${escapeHtml(song.artist || 'មិនស្គាល់')}</span></div>
                <span class="home-mini-play"><i class="fa-solid fa-play"></i></span>
            </button>`).join('');
    }

    // ២. រៀបចំបញ្ជី "Setlist ខែនេះ"
    if (setlistList) {
        const khmerMonths = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"];
        const currentMonthName = khmerMonths[new Date().getMonth()];
        
        // កំណត់ឈ្មោះខែឲ្យបានត្រឹមត្រូវ
        const sectionHead = setlistList.parentElement.querySelector('.home-section-head h2');
        if (sectionHead) sectionHead.innerText = `Setlist ខែ${currentMonthName}`;

        const totalSundays = getSundaysInCurrentMonth();
        const weeks = [];
        for (let i = 1; i <= totalSundays; i++) {
            weeks.push(`សប្តាហ៍ទី${i}`);
        }

        if (!globalSetlists) globalSetlists = {};

        setlistList.innerHTML = weeks.map(week => {
            const count = (globalSetlists[week] || []).length;
            return `<button class="home-album-card" style="width: 140px; flex: 0 0 140px; padding: 10px; border-radius: 14px; background: var(--card-bg); border: 1px solid var(--border); display: flex; align-items: center; gap: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);" onclick="filterBySetlist('${week}')">
                <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(37, 99, 235, 0.1); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">
                    <i class="fa-solid fa-calendar-check"></i>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-start; overflow: hidden;">
                    <strong style="font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${week}</strong>
                    <span style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">${count} បទ</span>
                </div>
            </button>`;
        }).join('');
    }
}

function renderSongs() {
    const searchVal = document.getElementById('searchInput').value.trim().toLowerCase();
    
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
        const searchString = `${song.title} ${song.artist} ${song.album} ${song.songKey || ''}`.toLowerCase();
        const matchSearch = !searchVal || searchString.includes(searchVal);

        let matchFilter = true;
        if (currentFilterType === 'ALBUM') matchFilter = song.album === currentFilterValue;
        
        return matchSearch && matchFilter;
    });

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

    renderSongsListOnly();
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

function handleSearchInput() {
    const input = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    const val = input.value.trim().toLowerCase();
    const dropdown = document.getElementById('searchDropdown');

    if (input.value.length > 0) clearBtn.style.display = 'flex';
    else clearBtn.style.display = 'none';

    renderSongs();

    if (!val) { hideSearchDropdown(); return; }

    const matches = songsList.filter(s => 
        (s.title && s.title.toLowerCase().includes(val)) ||
        (s.artist && s.artist.toLowerCase().includes(val))
    ).slice(0, 8);

    if (matches.length > 0) {
        dropdown.innerHTML = matches.map(s => `
            <div class="search-dropdown-item" onclick="selectSearchDropdownItem('${s.id}')">
                <div>
                    <div class="search-dropdown-title">${highlightSearchText(s.title, val)}</div>
                    <div class="search-dropdown-artist">🎤 ${highlightSearchText(s.artist || 'មិនស្គាល់', val)}</div>
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
    const grid = document.getElementById('playlistsGrid'); if (!grid) return;
    const keys = Object.keys(playlists);
    if (keys.length === 0) { 
        grid.innerHTML = `<div class="empty-state" style="margin-top: 30px;">
            <i class="fa-solid fa-folder-open empty-icon"></i>
            <div class="empty-title">ពុំទាន់មាន Playlist ទេ</div>
            <div class="empty-desc">អ្នកអាចបង្កើត Playlist ថ្មីដើម្បីងាយស្រួលរៀបចំបទចម្រៀងសម្រាប់ថ្វាយបង្គំ។</div>
        </div>`; 
        return; 
    }
    
    grid.innerHTML = keys.map(pName => {
        const count = (playlists[pName] || []).length;
        const isFav = (pName === 'Favorite');
        
        return `
            <div class="folder-card" onclick="filterByPlaylist('${escapeHtml(pName)}')">
                ${!isFav ? `<button class="folder-delete-btn" onclick="deletePlaylist(event, '${escapeHtml(pName)}')"><i class="fa-solid fa-trash"></i></button>` : ''}
                <div class="folder-icon-wrapper ${isFav ? 'fav-icon' : ''}">
                    <i class="fa-solid ${isFav ? 'fa-heart' : 'fa-list-ul'}"></i>
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
    if(confirm('តើអ្នកពិតជាចង់លុបទិន្នន័យ Offline ទាំងអស់មែនទេ? (វានឹងមិនលុប Playlist របស់អ្នកឡើយ)')) {
        if(dbIndexed) {
            const tx = dbIndexed.transaction('offlineSongs', 'readwrite');
            tx.objectStore('offlineSongs').clear();
        }
        vibratePhone(50);
        showToast('ជម្រះទិន្នន័យរួចរាល់', 'success');
        setTimeout(() => window.location.reload(), 1000);
    }
}

function toggleAutoScrollSetting(el) {
    el.classList.toggle('active');
    const isActive = el.classList.contains('active');
    localStorage.setItem('setting_autoscroll', isActive ? 'true' : 'false');
}

function toggleAutoScroll() {
    isAutoScrolling = !isAutoScrolling;
    const btn = document.getElementById('autoScrollBtn');
    if (isAutoScrolling) {
        btn.classList.add('active');
        requestAnimationFrame(autoScrollLoop);
    } else {
        btn.classList.remove('active');
    }
}
function adjustScrollSpeed(delta) {
    autoScrollSpeed += delta;
    if (autoScrollSpeed < 0.1) autoScrollSpeed = 0.1;
    if (autoScrollSpeed > 3.0) autoScrollSpeed = 3.0;
    document.getElementById('scrollSpeedLabel').innerText = autoScrollSpeed.toFixed(1) + 'x';
}
function autoScrollLoop() {
    if (!isAutoScrolling) return;
    pointY -= autoScrollSpeed;
    updateTransform();
    requestAnimationFrame(autoScrollLoop);
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
    if(isAutoScrolling) toggleAutoScroll();
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
function resetZoomState() { scale = 1; pointX = 0; pointY = 0; updateTransform(); }
function updateTransform() {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(() => {
        const img = document.getElementById('fullScreenImg');
        if (img) img.style.transform = `translate3d(${pointX}px, ${pointY}px, 0px) scale(${scale})`;
    });
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
            if (scale > 1) resetZoomState(); 
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

function addNewAlbum() { const albumName = prompt("បញ្ចូលឈ្មោះ Album ថ្មី៖"); if (albumName && albumName.trim() !== "") { db.collection("albums").add({ name: albumName.trim() }); showToast('បង្កើត Album រួចរាល់', 'success'); } }
function deleteAlbum(event, albumName) { event.stopPropagation(); if (confirm(`លុប Album "${albumName}"?`)) { db.collection("albums").where("name", "==", albumName).get().then((snapshot) => { snapshot.forEach((doc) => doc.ref.delete()); showToast('លុប Album រួចរាល់', 'info'); }); } }

async function uploadToCloudinary(base64Data) {
    const formData = new FormData(); formData.append('file', base64Data); formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET); formData.append('folder', 'worship_songs');
    const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.secure_url) return data.secure_url; else throw new Error(data.error ? data.error.message : 'Upload ទៅ Cloudinary មិនបានសម្រេច');
}

function processAndCompressFile(file, imgElemId, containerId, callback) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; const maxDim = 1200;
            if (width > maxDim || height > maxDim) { if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; } else { width = Math.round((width * maxDim) / height); height = maxDim; } }
            canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
            document.getElementById(imgElemId).src = compressedBase64; document.getElementById(containerId).style.display = 'block'; callback(compressedBase64);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function handleFileSelect(e) { processAndCompressFile(e.target.files[0], 'previewImg', 'previewContainer', (b64) => selectedImageBase64 = b64); }
function removeSelectedImage(e) { if (e) e.stopPropagation(); selectedImageBase64 = ''; document.getElementById('songImageFile').value = ''; document.getElementById('previewContainer').style.display = 'none'; }
function handleEditFileSelect(e) { processAndCompressFile(e.target.files[0], 'editPreviewImg', 'editPreviewContainer', (b64) => selectedEditImageBase64 = b64); }
function removeSelectedEditImage(e) { if (e) e.stopPropagation(); selectedEditImageBase64 = ''; document.getElementById('editSongImageFile').value = ''; document.getElementById('editPreviewContainer').style.display = 'none'; }

function handleBatchFilesSelect(e) {
    const files = Array.from(e.target.files); batchImagesArray = []; const previewInfo = document.getElementById('batchPreviewInfo'); const saveBtn = document.getElementById('batchSaveBtn');
    if (files.length === 0) { previewInfo.innerText = ''; saveBtn.disabled = true; return; }
    previewInfo.innerText = `ជ្រើសរើសបាន ${files.length} រូបភាព...`;
    let loadedCount = 0;
    files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; const maxDim = 1200;
                if (width > maxDim || height > maxDim) { if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; } else { width = Math.round((width * maxDim) / height); height = maxDim; } }
                canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                batchImagesArray.push({ name: file.name.replace(/\.[^/.]+$/, ""), base64: canvas.toDataURL('image/jpeg', 0.85) });
                loadedCount++; if (loadedCount === files.length) { previewInfo.innerText = `រួចរាល់ ${files.length} រូបភាព! ចុច "បញ្ចូលទាំងអស់"`; saveBtn.disabled = false; }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleBatchSaveSongs() {
    const album = document.getElementById('batchAlbumSelect').value; const artist = document.getElementById('batchArtist').value.trim(); const saveBtn = document.getElementById('batchSaveBtn'); const previewInfo = document.getElementById('batchPreviewInfo');
    if (batchImagesArray.length === 0) return; saveBtn.disabled = true;
    try {
        let count = 0; const batch = db.batch();
        for (const item of batchImagesArray) {
            count++; previewInfo.innerText = `Upload (${count}/${batchImagesArray.length})...`;
            const cloudUrl = await uploadToCloudinary(item.base64);
            batch.set(db.collection("songs").doc(), { album: album, title: item.name, artist: artist, songKey: "", mediaUrl: "", imageUrl: cloudUrl, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        previewInfo.innerText = 'កំពុងរក្សាទុក...'; await batch.commit();
        document.getElementById('batchImageFiles').value = ''; document.getElementById('batchPreviewInfo').innerText = ''; batchImagesArray = []; closeModal('batchAddModal'); showToast('បញ្ចូលជោគជ័យទាំងអស់', 'success');
    } catch (err) { showToast('បរាជ័យ៖ ' + err.message, 'error'); } 
    finally { saveBtn.disabled = false; saveBtn.innerText = 'បញ្ចូលទាំងអស់'; }
}

function deleteSong(songId) { if (confirm('តើអ្នកពិតជាចង់លុបបទចម្រៀងនេះមែនទេ?')) { db.collection("songs").doc(songId).delete(); showToast('បានលុបរួចរាល់', 'info'); } }

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
            ? '<i class="fa-solid fa-table-cells-large"></i> ទម្រង់ Grid' 
            : '<i class="fa-solid fa-list"></i> ទម្រង់ List';
    }
}

function applyStoredViewMode() {
    if (localStorage.getItem('app_view_mode') === 'list') {
        const grid = document.getElementById('songGrid');
        if (grid) grid.classList.add('list-view');
        const btn = document.getElementById('viewToggleBtn');
        if (btn) btn.innerHTML = '<i class="fa-solid fa-table-cells-large"></i> ទម្រង់ Grid';
    }
}

function escapeHtml(str) { if (!str) return ''; return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

let pendingSharePlaylistName = "";
let currentShareMode = "musician"; 

function handleShareCurrentPlaylist() {
    if ((currentFilterType === 'PLAYLIST' || currentFilterType === 'SETLIST') && currentFilterValue) {
        pendingSharePlaylistName = currentFilterValue;
        setShareMode('musician'); 
        openModal('sharePlaylistModal'); 
    }
}

function setShareMode(mode) {
    currentShareMode = mode;
    ['shareOptMusician', 'shareOptSinger', 'shareOptDark', 'shareOptTwoCol'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.remove('active');
    });
    
    let btnId = 'shareOptMusician';
    if(mode === 'singer') btnId = 'shareOptSinger';
    if(mode === 'dark') btnId = 'shareOptDark';
    if(mode === 'twocol') btnId = 'shareOptTwoCol';
    
    const activeEl = document.getElementById(btnId);
    if(activeEl) activeEl.classList.add('active');
}

function executeShare(type) {
    closeModal('sharePlaylistModal');
    if (type === 'pdf') {
        sharePlaylistAsPDF(pendingSharePlaylistName);
    } else {
        sharePlaylistAsImages(pendingSharePlaylistName);
    }
}

function generateLyricsImage(song, mode, playlistName) {
    return new Promise((resolve) => {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const isDark = (mode === 'dark');
            const isTwoCol = (mode === 'twocol');
            const hideChords = (mode === 'singer');
            
            const bgColor = isDark ? '#0f172a' : '#ffffff';
            const titleColor = isDark ? '#3b82f6' : '#2563eb';
            const textColor = isDark ? '#f8fafc' : '#0f172a';
            const metaColor = isDark ? '#94a3b8' : '#64748b';
            const chordColor = isDark ? '#f87171' : '#ef4444';
            
            let width = isTwoCol ? 1200 : 800; 
            
            const lines = (song.lyrics || '').split('\n');
            let totalLines = 0;
            
            lines.forEach(line => {
                if (line.trim() === '') totalLines += 0.5;
                else totalLines += 1; 
            });
            
            let linesPerCol = isTwoCol ? Math.ceil(totalLines / 2) + 2 : totalLines;
            let height = (linesPerCol * 45) + 200; 
            
            canvas.width = width;
            canvas.height = height; 
            
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            if (playlistName) {
                ctx.fillStyle = isDark ? '#1e293b' : '#f1f5f9';
                ctx.fillRect(0, 0, canvas.width, 40);
                ctx.fillStyle = metaColor;
                ctx.font = 'bold 18px "Kantumruy Pro", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`📅 Playlist: ${playlistName}  |  App ចម្រៀងសរសើរដំកើងព្រះ`, width/2, 26);
                ctx.textAlign = 'left'; 
            }
            
            ctx.fillStyle = titleColor;
            ctx.font = 'bold 36px "Kantumruy Pro", sans-serif';
            ctx.fillText(song.title || 'គ្មានចំណងជើង', 50, 90);
            
            ctx.fillStyle = metaColor;
            ctx.font = '24px "Kantumruy Pro", sans-serif';
            let printKey = song.songKey || 'C';
            printKey = printKey.split(/[\s,/-]+/)[0].trim();
            ctx.fillText(`🎤 ${song.artist || 'មិនស្គាល់'}   |   🎼 Key: ${printKey}`, 50, 130);
            
            ctx.strokeStyle = isDark ? '#334155' : '#d4d8e5';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(50, 150);
            ctx.lineTo(width - 50, 150);
            ctx.stroke();
            
            let col1X = 50;
            let col2X = 650;
            let startY = 210;
            let currentY = startY;
            let currentLineCount = 0;
            let isSecondCol = false;
            
            lines.forEach(line => {
                const trimmed = line.trim();
                
                if (isTwoCol && !isSecondCol && currentLineCount >= linesPerCol) {
                    isSecondCol = true;
                    currentY = startY;
                }
                
                let currentX = isSecondCol ? col2X : col1X;
                
                if (trimmed === '') {
                    currentY += 25;
                    currentLineCount += 0.5;
                } else {
                    let isHeader = /^(Intro|I\.|II\.|III\.|IV\.|V\.|Pre|R1\.|R2\.|Chorus|Bridge|Instr\.)/i.test(trimmed);
                    const parts = line.split(/(\[.*?\])/g);
                    
                    parts.forEach(part => {
                        if (part.startsWith('[')) {
                            if (!hideChords) {
                                let rawChord = part.replace(/[\[\]]/g, '');
                                let drawText = `[${rawChord}]`;
                                ctx.fillStyle = chordColor;
                                ctx.font = 'bold 24px Arial, sans-serif';
                                ctx.fillText(drawText, currentX, currentY);
                                currentX += ctx.measureText(drawText).width;
                            }
                        } else {
                            ctx.fillStyle = isHeader ? titleColor : textColor;
                            ctx.font = isHeader ? 'bold 28px "Kantumruy Pro", sans-serif' : '26px "Kantumruy Pro", sans-serif';
                            ctx.fillText(part, currentX, currentY);
                            currentX += ctx.measureText(part).width;
                        }
                    });
                    currentY += 45;
                    currentLineCount += 1;
                }
            });
            
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        } catch (e) {
            console.error("Canvas Error:", e);
            resolve(null);
        }
    });
}

function processExistingImage(imageUrl, mode, playlistName, songData) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const isDark = (mode === 'dark');
            const bgColor = isDark ? '#0f172a' : '#ffffff';
            const metaColor = isDark ? '#94a3b8' : '#64748b';
            
            canvas.width = img.width;
            canvas.height = img.height + 120;
            
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            if (isDark) {
                ctx.filter = 'invert(1) hue-rotate(180deg)';
                ctx.drawImage(img, 0, 100);
                ctx.filter = 'none'; 
            } else {
                ctx.drawImage(img, 0, 100);
            }
            
            if (playlistName) {
                ctx.fillStyle = isDark ? '#1e293b' : '#f1f5f9';
                ctx.fillRect(0, 0, canvas.width, 50);
                ctx.fillStyle = metaColor;
                ctx.font = 'bold 22px "Kantumruy Pro", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`📅 Playlist: ${playlistName}  |  App ចម្រៀងសរសើរដំកើងព្រះ`, canvas.width/2, 32);
                ctx.textAlign = 'left';
            }
            
            ctx.fillStyle = isDark ? '#3b82f6' : '#2563eb';
            ctx.font = 'bold 36px "Kantumruy Pro", sans-serif';
            ctx.fillText(songData.title || 'រូបភាពចម្រៀង', 40, 85);
            
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = () => resolve(imageUrl); 
        
        if (imageUrl.startsWith('data:image')) img.src = imageUrl;
        else img.src = imageUrl + '?' + new Date().getTime(); 
    });
}

async function getSongBlobOrDataUrl(song, playlistName) {
    if (song.lyrics && (!song.imageUrl || song.imageUrl.length < 10)) {
        return await generateLyricsImage(song, currentShareMode, playlistName);
    } else if (song.imageUrl) {
        return await processExistingImage(song.imageUrl, currentShareMode, playlistName, song);
    }
    return null;
}

async function downloadSongAction(songId) {
    const song = songsList.find(s => s.id === songId); if (!song) return;
    try {
        showToast('កំពុងរៀបចំទាញយក...', 'info');
        const imgData = await getSongBlobOrDataUrl(song, null);
        if(!imgData) { showToast('គ្មានទិន្នន័យសម្រាប់ទាញយកទេ', 'warning'); return; }

        const fileName = `${song.title.replace(/[^a-zA-Z0-9\u1780-\u17FF]/g, "_")}.jpg`;
        if (imgData.startsWith('data:image')) { 
            const a = document.createElement('a'); a.href = imgData; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); 
        } else { 
            const res = await fetch(imgData); const blob = await res.blob(); const blobUrl = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.href = blobUrl; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(blobUrl); 
        }
        showToast('ទាញយករួចរាល់', 'success');
    } catch (e) { console.log(e); showToast('បរាជ័យក្នុងការទាញយក', 'error'); }
}

async function shareSongImage(songId) {
    const song = songsList.find(s => s.id === songId); if (!song) return;
    const shareTitle = song.title || 'ចម្រៀងសរសើរដំកើង'; 
    const shareText = `🎵 ${song.title || ''}`;
    try {
        showToast('កំពុងរៀបចំទិន្នន័យ...', 'info');
        const imgData = await getSongBlobOrDataUrl(song, null);
        if (!imgData) { showToast('មិនមានរូបភាពទេ', 'warning'); return; }

        let fileObj = null;
        if (imgData.startsWith('data:image')) {
            const arr = imgData.split(','); 
            const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg'; 
            const bstr = atob(arr[1]); let n = bstr.length; const u8arr = new Uint8Array(n); 
            while (n--) u8arr[n] = bstr.charCodeAt(n);
            fileObj = new File([new Blob([u8arr], { type: mime })], `${shareTitle.replace(/[^a-zA-Z0-9\u1780-\u17FF]/g, "_")}.jpg`, { type: mime });
        } else { 
            const res = await fetch(imgData); const blob = await res.blob(); 
            fileObj = new File([blob], `${shareTitle.replace(/[^a-zA-Z0-9\u1780-\u17FF]/g, "_")}.jpg`, { type: blob.type || 'image/jpeg' }); 
        }
        
        if (navigator.canShare && fileObj && navigator.canShare({ files: [fileObj] })) {
            await navigator.share({ title: shareTitle, text: shareText, files: [fileObj] });
        } else if (navigator.share) {
            await navigator.share({ title: shareTitle, text: shareText, url: imgData.startsWith('http') ? imgData : undefined });
        } else {
            downloadSongAction(songId);
            showToast('បាន Save ចូលទូរស័ព្ទជំនួសការ Share', 'info');
        }
    } catch (err) { console.error(err); showToast('មានបញ្ហាក្នុងការ Share', 'error'); }
}

async function sharePlaylistAsPDF(playlistName) {
    let songIds = currentFilterType === 'SETLIST' ? globalSetlists[playlistName] : playlists[playlistName];
    if (!songIds || songIds.length === 0) return;

    showToast('កំពុងបង្កើត PDF សូមរង់ចាំបន្តិច...', 'info');

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'px' }); 
        doc.deletePage(1); 
        doc.setDisplayMode('fullpage', 'single');
        
        let hasImages = false;

        for (let i = 0; i < songIds.length; i++) {
            const song = songsList.find(s => s.id === songIds[i]);
            if (!song) continue;

            const urlToUse = await getSongBlobOrDataUrl(song, playlistName);
            if (!urlToUse) continue;

            const imgData = await getCleanBase64ForPDF(urlToUse);
            if (!imgData) continue;

            const imgProps = doc.getImageProperties(imgData);
            const orientation = imgProps.width > imgProps.height ? 'l' : 'p';
            const format = [imgProps.width, imgProps.height];
            
            doc.addPage(format, orientation);
            doc.addImage(imgData, 'JPEG', 0, 0, imgProps.width, imgProps.height);
            hasImages = true;
        }

        if (!hasImages) {
            showToast('មិនមានទិន្នន័យសម្រាប់បង្កើត PDF ទេ', 'warning');
            return;
        }

        const pdfBlob = doc.output('blob');
        const safeName = playlistName.replace(/[^a-zA-Z0-9\u1780-\u17FF]/g, "_");
        const pdfFile = new File([pdfBlob], `${safeName}.pdf`, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
            await navigator.share({
                title: `Playlist: ${playlistName}`,
                text: `ចម្រៀងសម្រាប់: ${playlistName}`,
                files: [pdfFile]
            });
        } else {
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url; a.download = `${safeName}.pdf`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('បានទាញយកជា PDF', 'success');
        }
    } catch (err) {
        console.error(err);
        showToast('មានបញ្ហាក្នុងការបង្កើត PDF', 'error');
    }
}

function getCleanBase64ForPDF(url) {
    return new Promise((resolve) => {
        if (url.startsWith('data:image')) { resolve(url); return; }
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

async function sharePlaylistAsImages(playlistName) {
    let songIds = currentFilterType === 'SETLIST' ? globalSetlists[playlistName] : playlists[playlistName];
    if (!songIds || songIds.length === 0) return;

    showToast('កំពុងរៀបចំរូបភាព...', 'info');
    
    let filesToShare = [];
    for (let i = 0; i < songIds.length; i++) {
        const song = songsList.find(s => s.id === songIds[i]);
        if (!song) continue;

        const safeTitle = song.title ? song.title.replace(/[^a-zA-Z0-9\u1780-\u17FF]/g, "_") : 'Song';
        const fileName = `${i + 1}_${safeTitle}.jpg`; 

        try {
            let fileObj = null;
            const urlToUse = await getSongBlobOrDataUrl(song, playlistName);
            if (!urlToUse) continue;

            if (urlToUse.startsWith('data:image')) {
                const arr = urlToUse.split(','); 
                const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg'; 
                const bstr = atob(arr[1]); 
                let n = bstr.length; 
                const u8arr = new Uint8Array(n); 
                while (n--) u8arr[n] = bstr.charCodeAt(n);
                fileObj = new File([new Blob([u8arr], { type: mime })], fileName, { type: mime });
            } else {
                const res = await fetch(urlToUse);
                const blob = await res.blob();
                fileObj = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
            }
            if (fileObj) filesToShare.push(fileObj);
        } catch (err) {}
    }

    if (filesToShare.length > 0) {
        if (navigator.canShare && navigator.canShare({ files: filesToShare })) {
            try {
                await navigator.share({
                    title: `Playlist: ${playlistName}`,
                    text: `សូមជូនបទចម្រៀងពី Playlist: ${playlistName}`,
                    files: filesToShare
                });
            } catch (err) {}
        } else {
            showToast('Browser របស់អ្នកមិនគាំទ្រការ Share ទេ', 'warning');
        }
    }
}

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
    
    const mediaBtn = document.getElementById('fsMediaPlayBtn');
    if(song.mediaUrl) { mediaBtn.style.display = 'flex'; mediaBtn.onclick = () => playAudio(song.mediaUrl, song.title); }
    else { mediaBtn.style.display = 'none'; }

    const imgEl = document.getElementById('fullScreenImg');
    const lyricsEl = document.getElementById('fullScreenLyrics');
    const transposeEl = document.getElementById('transposeControls');
    const scrollControls = document.getElementById('fsScrollControls');

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

    const showScroll = localStorage.getItem('setting_autoscroll') === 'true';
    scrollControls.style.display = showScroll ? 'flex' : 'none';

    if(isAutoScrolling) toggleAutoScroll();
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

function switchInputType(modalType, inputType) {
    if (modalType === 'add') {
        document.getElementById('tabAddImg').classList.toggle('active', inputType === 'image');
        document.getElementById('tabAddText').classList.toggle('active', inputType === 'text');
        document.getElementById('addSectionImage').style.display = inputType === 'image' ? 'block' : 'none';
        document.getElementById('addSectionText').style.display = inputType === 'text' ? 'block' : 'none';
    } else if (modalType === 'edit') {
        document.getElementById('tabEditImg').classList.toggle('active', inputType === 'image');
        document.getElementById('tabEditText').classList.toggle('active', inputType === 'text');
        document.getElementById('editSectionImage').style.display = inputType === 'image' ? 'block' : 'none';
        document.getElementById('editSectionText').style.display = inputType === 'text' ? 'block' : 'none';
    }
}

async function handleAddSong(e) {
    e.preventDefault();
    const album = document.getElementById('songAlbumSelect').value; 
    const title = document.getElementById('songTitle').value.trim(); 
    const artist = document.getElementById('songArtist').value.trim(); 
    const songKey = document.getElementById('songKey').value.trim(); 
    const mediaUrl = document.getElementById('songMediaUrl').value.trim(); 
    const directUrl = document.getElementById('songImageUrlDirect').value.trim();
    const lyrics = document.getElementById('songLyricsInput').value; 
    
    if (!selectedImageBase64 && !directUrl && !lyrics.trim()) { 
        showToast('សូមជ្រើសរើសរូបភាព ឬវាយអត្ថបទបញ្ជូល', 'warning'); return; 
    }
    
    const saveBtn = document.getElementById('saveBtn'); saveBtn.disabled = true; saveBtn.innerText = 'កំពុងរក្សាទុក...';
    try {
        let finalImageUrl = directUrl; 
        if (selectedImageBase64) finalImageUrl = await uploadToCloudinary(selectedImageBase64);
        
        await db.collection("songs").add({ 
            album, title, artist, songKey, mediaUrl, 
            imageUrl: finalImageUrl, 
            lyrics: lyrics, 
            createdAt: firebase.firestore.FieldValue.serverTimestamp() 
        });
        
        document.getElementById('addSongForm').reset(); 
        document.getElementById('songLyricsInput').value = '';
        removeSelectedImage(null); 
        closeModal('addSongModal'); 
        showToast('បញ្ចូលបទចម្រៀងរួចរាល់', 'success');
    } catch (err) { showToast('មានបញ្ហា៖ ' + err.message, 'error'); } 
    finally { saveBtn.disabled = false; saveBtn.innerText = 'រក្សាទុក'; }
}

function openEditSongModal(songId) {
    const song = songsList.find(s => s.id === songId); if (!song) return;
    document.getElementById('editSongId').value = song.id; 
    document.getElementById('editSongAlbumSelect').value = song.album || customAlbums[0]; 
    document.getElementById('editSongTitle').value = song.title || ''; 
    document.getElementById('editSongArtist').value = song.artist || ''; 
    document.getElementById('editSongKey').value = song.songKey || ''; 
    document.getElementById('editSongMediaUrl').value = song.mediaUrl || ''; 
    document.getElementById('editSongImageUrlDirect').value = song.imageUrl && !song.imageUrl.startsWith('data:') ? song.imageUrl : '';
    document.getElementById('editSongLyricsInput').value = song.lyrics || ''; 
    
    if (song.imageUrl && song.imageUrl.startsWith('data:')) { 
        selectedEditImageBase64 = song.imageUrl; 
        document.getElementById('editPreviewImg').src = song.imageUrl; 
        document.getElementById('editPreviewContainer').style.display = 'block'; 
    } else removeSelectedEditImage(null);

    if (song.lyrics && song.lyrics.trim().length > 0) {
        switchInputType('edit', 'text');
    } else {
        switchInputType('edit', 'image');
    }
    openModal('editSongModal');
}

async function handleUpdateSong(e) {
    e.preventDefault();
    const id = document.getElementById('editSongId').value; 
    const album = document.getElementById('editSongAlbumSelect').value; 
    const title = document.getElementById('editSongTitle').value.trim(); 
    const artist = document.getElementById('editSongArtist').value.trim(); 
    const songKey = document.getElementById('editSongKey').value.trim(); 
    const mediaUrl = document.getElementById('editSongMediaUrl').value.trim(); 
    const directUrl = document.getElementById('editSongImageUrlDirect').value.trim();
    const lyrics = document.getElementById('editSongLyricsInput').value; 
    
    const updateBtn = document.getElementById('updateBtn'); updateBtn.disabled = true; updateBtn.innerText = 'កំពុងរក្សាទុក...';
    try {
        const updateData = { album, title, artist, songKey, mediaUrl, lyrics, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
        if (selectedEditImageBase64) { 
            updateBtn.innerText = 'Upload រូបភាពថ្មី...'; 
            updateData.imageUrl = await uploadToCloudinary(selectedEditImageBase64); 
        } else if (directUrl) {
            updateData.imageUrl = directUrl;
        }
        await db.collection("songs").doc(id).update(updateData); 
        closeModal('editSongModal'); 
        showToast('កែប្រែបានជោគជ័យ', 'success');
    } catch (err) { showToast('កែប្រែមិនបានសម្រេច៖ ' + err.message, 'error'); } 
    finally { updateBtn.disabled = false; updateBtn.innerText = 'រក្សាទុក'; }
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

function playAudio(mediaUrl, title) {
    if(!mediaUrl) return;
    if (mediaUrl.includes('youtube.com') || mediaUrl.includes('youtu.be')) {
        window.open(mediaUrl, '_blank');
        return;
    }
    const player = document.getElementById('miniPlayer');
    const audio = document.getElementById('audioElement');
    const titleEl = document.getElementById('miniPlayerTitle');
    const playBtn = document.getElementById('playPauseBtn');
    
    player.style.display = 'flex';
    titleEl.innerText = title;
    audio.src = mediaUrl;
    audio.play().then(() => {
        playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }).catch(err => {
        showToast('មិនអាចចាក់ឯកសារសំឡេងនេះបានទេ (សូមប្រើ Mp3 URL)', 'warning');
    });
}

function togglePlayPause() {
    const audio = document.getElementById('audioElement');
    const playBtn = document.getElementById('playPauseBtn');
    if (audio.paused) {
        audio.play();
        playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    } else {
        audio.pause();
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }
}

function closeMiniPlayer() {
    const audio = document.getElementById('audioElement');
    audio.pause();
    document.getElementById('miniPlayer').style.display = 'none';
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

let audioCtx = null;
let metronomeTimer = null;
let currentBpm = 80;
let isMetronomePlaying = false;

function toggleMetronomePanel() {
    const panel = document.getElementById('metronomePanel');
    panel.style.display = (panel.style.display === 'flex') ? 'none' : 'flex';
}

function changeBpm(delta) {
    currentBpm += delta;
    if (currentBpm < 40) currentBpm = 40;
    if (currentBpm > 240) currentBpm = 240;
    document.getElementById('bpmValue').innerText = currentBpm;
    
    if (isMetronomePlaying) {
        clearInterval(metronomeTimer);
        metronomeTimer = setInterval(playClickSound, 60000 / currentBpm);
    }
}

function playClickSound() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.frequency.value = 1000; 
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.1);

    const bpmDisplay = document.getElementById('bpmValue');
    if (bpmDisplay) {
        bpmDisplay.classList.remove('metronome-flash');
        void bpmDisplay.offsetWidth; 
        bpmDisplay.classList.add('metronome-flash');
    }
}

function toggleMetronomePlay() {
    const btn = document.getElementById('metroPlayBtn');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    if (isMetronomePlaying) {
        clearInterval(metronomeTimer);
        isMetronomePlaying = false;
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fa-solid fa-play"></i>';
    } else {
        audioCtx.resume();
        playClickSound(); 
        metronomeTimer = setInterval(playClickSound, 60000 / currentBpm);
        isMetronomePlaying = true;
        btn.classList.add('active');
        btn.innerHTML = '<i class="fa-solid fa-square"></i>';
    }
}

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

let tunerAudioCtx = null;
let analyser = null;
let microphone = null;
let isTunerActive = false;
let tunerAnimFrame = null;

const guitarStrings = [
    { note: 'E', freq: 82.41 },
    { note: 'A', freq: 110.00 },
    { note: 'D', freq: 146.83 },
    { note: 'G', freq: 196.00 },
    { note: 'B', freq: 246.94 },
    { note: 'E', freq: 329.63 }
];

function toggleMainTunerPanel() {
    const panel = document.getElementById('mainTunerPanel');
    const isShowing = panel.style.display === 'flex';
    
    if (isShowing) {
        panel.style.display = 'none';
        document.body.classList.remove('no-scroll'); 
        if (isTunerActive) toggleTunerAction(); 
    } else {
        panel.style.display = 'flex';
        document.body.classList.add('no-scroll'); 
    }
}

async function toggleTunerAction() {
    const btn = document.getElementById('tunerBtn');
    
    if (isTunerActive) {
        if (tunerAnimFrame) cancelAnimationFrame(tunerAnimFrame);
        if (microphone) microphone.disconnect();
        if (tunerAudioCtx) await tunerAudioCtx.close();
        
        isTunerActive = false;
        btn.style.background = 'var(--primary)';
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i> បើកស្តាប់';
        document.getElementById('tunerNote').innerText = '--';
        document.getElementById('tunerNote').style.color = 'var(--text)';
        document.getElementById('tunerHz').innerText = '0 Hz';
        document.getElementById('tunerIndicator').style.left = '50%';
        document.getElementById('tunerIndicator').style.background = 'var(--text)';
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tunerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = tunerAudioCtx.createAnalyser();
        analyser.fftSize = 2048;
        
        microphone = tunerAudioCtx.createMediaStreamSource(stream);
        microphone.connect(analyser);
        
        isTunerActive = true;
        btn.style.background = '#ef4444'; 
        btn.innerHTML = '<i class="fa-solid fa-stop"></i> បិទស្តាប់';
        
        updatePitch();
    } catch (err) {
        showToast('សូមអនុញ្ញាត (Allow) ឱ្យប្រើប្រាស់ Microphone សិន', 'error');
    }
}

function autoCorrelate(buf, sampleRate) {
    let SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    let r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }

    buf = buf.slice(r1, r2);
    SIZE = buf.length;
    let c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++)
        for (let j = 0; j < SIZE - i; j++)
            c[i] = c[i] + buf[j] * buf[j + i];

    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }
    let T0 = maxpos;
    return sampleRate / T0;
}

function updatePitch() {
    if (!isTunerActive) return;
    
    let buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    let ac = autoCorrelate(buffer, tunerAudioCtx.sampleRate);
    
    if (ac !== -1 && ac > 50 && ac < 1000) { 
        let closestString = guitarStrings[0];
        let minDiff = Math.abs(ac - guitarStrings[0].freq);
        
        for (let i = 1; i < guitarStrings.length; i++) {
            let diff = Math.abs(ac - guitarStrings[i].freq);
            if (diff < minDiff) {
                minDiff = diff;
                closestString = guitarStrings[i];
            }
        }
        
        document.getElementById('tunerNote').innerText = closestString.note;
        document.getElementById('tunerHz').innerText = Math.round(ac) + ' Hz';
        
        let cents = 1200 * Math.log2(ac / closestString.freq);
        let indicatorPos = Math.max(-50, Math.min(50, cents));
        let leftPercent = ((indicatorPos + 50) / 100) * 100;
        
        const indicator = document.getElementById('tunerIndicator');
        const noteText = document.getElementById('tunerNote');
        
        indicator.style.left = leftPercent + '%';
        
        if (Math.abs(cents) < 5) {
            indicator.style.background = '#10b981'; 
            noteText.style.color = '#10b981';
        } else if (cents < 0) {
            indicator.style.background = '#f59e0b'; 
            noteText.style.color = '#f59e0b';
        } else {
            indicator.style.background = '#ef4444'; 
            noteText.style.color = '#ef4444';
        }
    }
    
    tunerAnimFrame = requestAnimationFrame(updatePitch);
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

// បើក/បិទ ផ្ទាំង Profile Popup និងប្តូរពណ៌ប៊ូតុង
function toggleProfilePopup(event) {
    if(event) event.stopPropagation();
    const popup = document.getElementById('profilePopup');
    const profileBtn = document.getElementById('homeProfileBtn'); // យក Element របស់ប៊ូតុង
    
    if(popup) {
        popup.classList.toggle('show');
        
        if(popup.classList.contains('show')) {
            if(profileBtn) profileBtn.classList.add('active'); // ដាក់ពណ៌ឲ្យប៊ូតុង ពេលបើក
            renderProfilePopup();
        } else {
            if(profileBtn) profileBtn.classList.remove('active'); // ដកពណ៌ចេញវិញ ពេលបិទ
        }
    }
}

// ទាញយកទិន្នន័យមកបង្ហាញក្នុង Profile Popup
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
        // បង្ហាញនៅពេលអ្នកប្រើប្រាស់មិនទាន់ Login
        content.innerHTML = `
            <div style="text-align: center; padding: 10px 0 15px 0;">
                <i class="fa-regular fa-circle-user" style="font-size: 3.5rem; color: var(--text-muted); margin-bottom: 10px;"></i>
                <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">អ្នកមិនទាន់បាន Login នៅឡើយទេ</div>
            </div>
            <button class="profile-popup-btn" style="background: var(--primary); color: white;" onclick="handleGoogleLogin(); toggleProfilePopup();"><i class="fa-brands fa-google"></i> Login ចូលប្រើប្រាស់</button>
        `;
    }
}

// អនុញ្ញាតឱ្យបើកផ្ទាំង Modal និងកំណត់ Tab លំនាំដើម
function openNotificationModal() {
    openModal('notificationModal');
    switchNotifTab('news'); // បើក Tab "ព័ត៌មានថ្មីៗ" មុនគេ
    loadAdminMessages();    // ទាញយកសារ
    renderNewSongsTab();    // រៀបចំបទចម្រៀង២០បទ
}

// មុខងារប្តូរ Tab ពណ៌ស និងថ្លា
function switchNotifTab(tab) {
    const btnNews = document.getElementById('btnTabNews');
    const btnSongs = document.getElementById('btnTabSongs');
    const contentNews = document.getElementById('contentTabNews');
    const contentSongs = document.getElementById('contentTabSongs');

    if(tab === 'news') {
        btnNews.style.background = 'white';
        btnNews.style.color = 'var(--primary)';
        btnSongs.style.background = 'transparent';
        btnSongs.style.color = 'white';
        contentNews.style.display = 'block';
        contentSongs.style.display = 'none';
    } else {
        btnSongs.style.background = 'white';
        btnSongs.style.color = 'var(--primary)';
        btnNews.style.background = 'transparent';
        btnNews.style.color = 'white';
        contentSongs.style.display = 'block';
        contentNews.style.display = 'none';
    }
}

// មុខងារសម្រាប់ Admin ផ្ញើសារ
function sendAdminMessage() {
    const msg = document.getElementById('adminMsgInput').value.trim();
    if(!msg) return;
    
    // បង្កើត Collection ថ្មីឈ្មោះ messages ក្នុង Firebase
    db.collection('messages').add({
        text: msg,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        sender: currentUser.displayName || 'Admin'
    }).then(() => {
        document.getElementById('adminMsgInput').value = '';
        showToast('បានផ្ញើសារជូនដំណឹងរួចរាល់', 'success');
    }).catch((err) => {
        showToast('មិនអាចផ្ញើសារបានទេ៖ ' + err.message, 'error');
    });
}

// មុខងារទាញយកសារមកបង្ហាញជាទម្រង់កាត (Card)
function loadAdminMessages() {
    db.collection('messages').orderBy('createdAt', 'desc').limit(30).onSnapshot(snapshot => {
        const container = document.getElementById('newsListContainer');
        if (snapshot.empty) {
            // បង្ហាញនៅចំកណ្តាលអេក្រង់
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 60vh; color: #94a3b8;">
                    <i class="fa-regular fa-folder-open" style="font-size: 3.5rem; margin-bottom: 15px; color: #cbd5e1;"></i>
                    <div style="font-size: 1.1rem; font-weight: 600; color: #64748b;">គ្មានព័ត៌មានទេ</div>
                </div>`;
            return;
        }
        
        let html = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            let dateStr = 'ថ្មីៗ';
            if (data.createdAt) {
                const d = new Date(data.createdAt.toDate());
                dateStr = d.toLocaleDateString('km-KH') + ' | ' + d.toLocaleTimeString('km-KH', {hour: '2-digit', minute:'2-digit'});
            }
            
            // រចនាប័ណ្ណសារ ស្រដៀងនឹងរូបភាពធនាគាររបស់អ្នក
            html += `
                <div style="background: white; padding: 15px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); text-align: left;">
                    <div style="display: flex; gap: 12px; align-items: flex-start;">
                        <div style="background: rgba(37, 99, 235, 0.1); color: var(--primary); width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1rem;">
                            <i class="fa-solid fa-envelope-open-text"></i>
                        </div>
                        <div>
                            <div style="font-size: 0.9rem; color: var(--text); font-weight: 600; line-height: 1.4; margin-bottom: 6px;">
                                ${escapeHtml(data.text)}
                            </div>
                            <div style="font-size: 0.72rem; color: var(--text-muted);">
                                ${dateStr}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    });
}

// មុខងារបង្ហាញចម្រៀងទើបបញ្ចូលថ្មី ២០បទចុងក្រោយ
function renderNewSongsTab() {
    const container = document.getElementById('newSongsListContainer');
    if(!songsList || songsList.length === 0) {
        // បង្ហាញនៅចំកណ្តាលអេក្រង់
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 60vh; color: #94a3b8;">
                <i class="fa-solid fa-music" style="font-size: 3.5rem; margin-bottom: 15px; color: #cbd5e1;"></i>
                <div style="font-size: 1.1rem; font-weight: 600; color: #64748b;">គ្មានព័ត៌មានទេ</div>
            </div>`;
        return;
    }

    // ដោយសារ songsList ត្រូវបាន sort តាមថ្ងៃបញ្ចូលរួចហើយ យើងគ្រាន់តែយក ២០បទដំបូងប៉ុណ្ណោះ
    const top20 = songsList.slice(0, 20);
    
    let html = '';
    top20.forEach((song, index) => {
        html += `
            <div onclick="openFullScreenModal('${song.id}'); closeModal('notificationModal');" style="background: white; padding: 12px 15px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; align-items: center; gap: 12px; cursor: pointer; transition: 0.2s;">
                <div style="font-weight: 800; font-size: 1rem; color: var(--primary); width: 25px; text-align: center;">
                    ${index + 1}
                </div>
                <div style="flex: 1; font-size: 0.9rem; font-weight: 600; color: var(--text); overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
                    ${escapeHtml(song.title)}
                </div>
                <div style="background: rgba(37,99,235,0.1); color: var(--primary); padding: 4px 8px; border-radius: 20px; font-size: 0.65rem; font-weight: bold;">
                    <i class="fa-solid fa-play"></i>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// =========================================
/// =========================================
// កូដសម្រាប់ផ្ទាំងការជូនដំណឹង (រចនាបថអេស៊ីលីដា / Full Screen)
// =========================================

// បើកផ្ទាំងពេញអេក្រង់ និងទាញទិន្នន័យ
function openAcledaNotifScreen() {
    document.getElementById('acledaNotifScreen').style.display = 'block';
    document.body.classList.add('no-scroll');
    
    const dot = document.getElementById('navNotifDot');
    if(dot) dot.style.display = 'none';

    // កំណត់បើក Tab ព័ត៌មានថ្មីៗមុនគេជានិច្ច
    switchAcledaTab('news');
    loadAcledaAdminMessages();
    renderAcledaNewSongs();
}

// បិទផ្ទាំង
function closeAcledaNotifScreen() {
    document.getElementById('acledaNotifScreen').style.display = 'none';
    document.body.classList.remove('no-scroll');
}

// មុខងារចុចប្តូរ Tab បង្ហាញពណ៌ស/ខៀវ
function switchAcledaTab(tabName) {
    const btnNews = document.getElementById('tabBtnNews');
    const btnSongs = document.getElementById('tabBtnSongs');
    const contentNews = document.getElementById('tabContentNews');
    const contentSongs = document.getElementById('tabContentSongs');

    if (tabName === 'news') {
        btnNews.style.background = 'white';
        btnNews.style.color = '#0f3566';
        btnSongs.style.background = 'transparent';
        btnSongs.style.color = 'white';
        contentNews.style.display = 'block';
        contentSongs.style.display = 'none';
    } else {
        btnSongs.style.background = 'white';
        btnSongs.style.color = '#0f3566';
        btnNews.style.background = 'transparent';
        btnNews.style.color = 'white';
        contentSongs.style.display = 'block';
        contentNews.style.display = 'none';
    }
}

// មុខងារ Admin ផ្ញើសារ
function sendAdminMessage() {
    const msg = document.getElementById('adminMsgInput').value.trim();
    if(!msg) return;
    
    db.collection('messages').add({
        text: msg,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        sender: currentUser ? currentUser.displayName : 'Admin'
    }).then(() => {
        document.getElementById('adminMsgInput').value = '';
        showToast('បានផ្ញើសារជូនដំណឹងរួចរាល់', 'success');
    }).catch((err) => {
        showToast('មិនអាចផ្ញើសារបានទេ៖ ' + err.message, 'error');
    });
}

// =========================================
// កូដសម្រាប់ផ្ទាំងការជូនដំណឹង (Modern Music UI)
// =========================================

function openModernNotifScreen() {
    document.getElementById('modernNotifScreen').style.display = 'block';
    document.body.classList.add('no-scroll');
    
    const dot = document.getElementById('navNotifDot');
    if(dot) dot.style.display = 'none';

    switchModernTab('news');
    loadModernAdminMessages();
    renderModernNewSongs();
}

function closeModernNotifScreen() {
    document.getElementById('modernNotifScreen').style.display = 'none';
    document.body.classList.remove('no-scroll');
}

function switchModernTab(tabName) {
    const btnNews = document.getElementById('modTabNews');
    const btnSongs = document.getElementById('modTabSongs');
    const contentNews = document.getElementById('modContentNews');
    const contentSongs = document.getElementById('modContentSongs');

    if (tabName === 'news') {
        // Active News
        btnNews.style.background = 'var(--primary)';
        btnNews.style.color = 'white';
        btnNews.style.border = 'none';
        btnNews.style.boxShadow = '0 4px 10px rgba(37,99,235,0.2)';
        
        // Inactive Songs
        btnSongs.style.background = 'var(--card-bg)';
        btnSongs.style.color = 'var(--text-muted)';
        btnSongs.style.border = '1px solid var(--border)';
        btnSongs.style.boxShadow = 'none';

        contentNews.style.display = 'flex';
        contentSongs.style.display = 'none';
    } else {
        // Active Songs
        btnSongs.style.background = 'var(--primary)';
        btnSongs.style.color = 'white';
        btnSongs.style.border = 'none';
        btnSongs.style.boxShadow = '0 4px 10px rgba(37,99,235,0.2)';
        
        // Inactive News
        btnNews.style.background = 'var(--card-bg)';
        btnNews.style.color = 'var(--text-muted)';
        btnNews.style.border = '1px solid var(--border)';
        btnNews.style.boxShadow = 'none';

        contentSongs.style.display = 'flex';
        contentNews.style.display = 'none';
    }
}

function sendModernAdminMessage() {
    const msg = document.getElementById('modAdminMsgInput').value.trim();
    if(!msg) return;
    
    db.collection('messages').add({
        text: msg,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        sender: currentUser ? currentUser.displayName : 'Admin'
    }).then(() => {
        document.getElementById('modAdminMsgInput').value = '';
        showToast('បានផ្ញើសារជូនដំណឹងរួចរាល់', 'success');
    }).catch((err) => {
        showToast('មិនអាចផ្ញើសារបានទេ៖ ' + err.message, 'error');
    });
}

function loadModernAdminMessages() {
    db.collection('messages').orderBy('createdAt', 'desc').limit(30).onSnapshot(snapshot => {
        const container = document.getElementById('modNewsList');
        if(!container) return;
        
        if (snapshot.empty) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; flex: 1; color: var(--text-muted);">
                    <div style="width: 80px; height: 80px; background: var(--card-bg); border-radius: 50%; display: flex; justify-content: center; align-items: center; margin-bottom: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
                        <i class="fa-regular fa-bell-slash" style="font-size: 2rem; color: var(--border);"></i>
                    </div>
                    <div style="font-size: 1.1rem; font-weight: 700; color: var(--text);">គ្មានព័ត៌មានទេ</div>
                    <div style="font-size: 0.85rem; margin-top: 5px;">ព័ត៌មានថ្មីៗនឹងបង្ហាញនៅទីនេះ</div>
                </div>`;
            return;
        }
        
        let html = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            let dateStr = 'ថ្មីៗ';
            if (data.createdAt) {
                const d = new Date(data.createdAt.toDate());
                const khmerMonths = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"];
                dateStr = d.getDate() + ' ' + khmerMonths[d.getMonth()] + ' ' + d.getFullYear() + ' • ' + d.toLocaleTimeString('km-KH', {hour: '2-digit', minute:'2-digit'});
            }
            
            html += `
                <div style="background: var(--card-bg); border-radius: 18px; padding: 18px; display: flex; gap: 15px; align-items: flex-start; box-shadow: 0 4px 15px rgba(0,0,0,0.03); border: 1px solid var(--border);">
                    <div style="background: rgba(37,99,235,0.1); color: var(--primary); width: 45px; height: 45px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.2rem;">
                        <i class="fa-solid fa-bullhorn"></i>
                    </div>
                    <div>
                        <div style="font-size: 0.95rem; color: var(--text); font-weight: 700; margin-bottom: 4px; line-height: 1.4;">${escapeHtml(data.text)}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">${dateStr}</div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }, error => {
        const container = document.getElementById('modNewsList');
        if(container) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; flex: 1; color: var(--text-muted);">
                    <div style="width: 80px; height: 80px; background: var(--card-bg); border-radius: 50%; display: flex; justify-content: center; align-items: center; margin-bottom: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
                        <i class="fa-regular fa-bell-slash" style="font-size: 2rem; color: var(--border);"></i>
                    </div>
                    <div style="font-size: 1.1rem; font-weight: 700; color: var(--text);">គ្មានព័ត៌មានទេ</div>
                </div>`;
        }
    });
}

function renderModernNewSongs() {
    const container = document.getElementById('modSongsList');
    if(!container) return;
    
    if(!songsList || songsList.length === 0) {
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; flex: 1; color: var(--text-muted);">
                <div style="width: 80px; height: 80px; background: var(--card-bg); border-radius: 50%; display: flex; justify-content: center; align-items: center; margin-bottom: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
                    <i class="fa-solid fa-music" style="font-size: 2rem; color: var(--border);"></i>
                </div>
                <div style="font-size: 1.1rem; font-weight: 700; color: var(--text);">គ្មានបទចម្រៀងទេ</div>
            </div>`;
        return;
    }

    const top20 = songsList.slice(0, 20);
    let html = '';
    
    top20.forEach((song) => {
        let dateStr = '';
        if (song.createdAt) {
            const d = new Date(song.createdAt.seconds * 1000);
            const khmerMonths = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"];
            dateStr = d.getDate() + ' ' + khmerMonths[d.getMonth()] + ' ' + d.getFullYear();
        }

        let coverHtml = '';
        if (song.imageUrl && song.imageUrl.length > 10) {
            coverHtml = `<img src="${song.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;" alt="cover">`;
        } else {
            coverHtml = `<i class="fa-solid fa-music"></i>`;
        }

        html += `
            <div onclick="openFullScreenModal('${song.id}'); closeModernNotifScreen();" style="background: var(--card-bg); border-radius: 16px; padding: 12px; display: flex; align-items: center; gap: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); border: 1px solid var(--border); cursor: pointer; transition: transform 0.2s;">
                <div style="background: var(--bg); color: var(--primary); width: 55px; height: 55px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.5rem; overflow: hidden;">
                    ${coverHtml}
                </div>
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-size: 1rem; color: var(--text); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px;">${escapeHtml(song.title)}</div>
                    <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">🎤 ${escapeHtml(song.artist || 'មិនស្គាល់')} • ${dateStr}</div>
                </div>
                <div style="background: rgba(37,99,235,0.1); color: var(--primary); width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.9rem;">
                    <i class="fa-solid fa-play"></i>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// =========================================
// មុខងារបង្ហាញខគម្ពីរលើកទឹកចិត្តចៃដន្យ (Random Daily Verse)
// =========================================

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
        // ចាប់យកខគម្ពីរចៃដន្យ (Random) រាល់ពេលបើកកម្មវិធី
        const randomIndex = Math.floor(Math.random() * worshipVerses.length);
        const verse = worshipVerses[randomIndex];
        
        // ដាក់បញ្ចូលទៅក្នុង HTML
        verseTextEl.innerText = verse.text;
        verseRefEl.innerText = verse.ref;
    }
}

// ហៅមុខងារនេះឲ្យដំណើរការនៅពេលកម្មវិធីចាប់ផ្តើម
document.addEventListener('DOMContentLoaded', () => {
    displayRandomVerse();
});
