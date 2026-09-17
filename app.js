const firebaseConfig = {
    apiKey: "AIzaSyA1sUfsUCsfqFYBAG7xEVhwP0Y64d5TA_8",
    authDomain: "worship-bkc.firebaseapp.com",
    projectId: "worship-bkc",
    storageBucket: "worship-bkc.firebasestorage.app",
    messagingSenderId: "585802631589",
    appId: "1:585802631589:web:ebeaa5f89cac319309404c",
    measurementId: "G-NRX7KRF6TY"
};
firebase.initializeApp(firebaseConfig);
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

// អថេរសម្រាប់ Transpose
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
    const isFiltered = (currentFilterType === 'ALBUM' || currentFilterType === 'PLAYLIST');

    if (tabName === 'songs') {
        if (mainHeader) mainHeader.style.display = isFiltered ? 'none' : 'flex';
        document.getElementById('viewSongs').classList.add('active');
        document.getElementById('navSongsBtn').classList.add('active');
    } else if (tabName === 'albums') {
        if (mainHeader) mainHeader.style.display = 'flex';
        document.getElementById('viewAlbums').classList.add('active');
        document.getElementById('navAlbumsBtn').classList.add('active');
        renderAlbumsView();
    } else if (tabName === 'playlists') {
        if (mainHeader) mainHeader.style.display = 'flex';
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
            db.collection("users").doc(user.uid).get().then((doc) => {
                if (doc.exists) { 
                    const userData = doc.data(); 
                    isAdmin = userData.role === 'admin'; 
                    isEditor = isAdmin || userData.role === 'editor'; 
                    
                    if (userData.playlists) {
                        playlists = Object.assign({}, playlists, userData.playlists);
                        localStorage.setItem('user_playlists', JSON.stringify(playlists));
                        renderPlaylistsView();
                        renderSongsListOnly();
                    } else {
                        syncPlaylistsToCloud();
                    }
                } else { isAdmin = false; isEditor = false; }
                updateUIRoles();
            }).catch(() => { isAdmin = false; isEditor = false; updateUIRoles(); });
        } else { isAdmin = false; isEditor = false; updateUIRoles(); }
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

function renderSongs() {
    const searchVal = document.getElementById('searchInput').value.trim().toLowerCase();
    
    let filtered = [];
    
    if (currentFilterType === 'PLAYLIST') {
        const pList = playlists[currentFilterValue] || [];
        filtered = pList.map(id => songsList.find(s => s.id === id)).filter(s => s);
    } else if (currentFilterType === 'RECENT') {
        filtered = [...songsList].sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.seconds : 0;
            const timeB = b.createdAt ? b.createdAt.seconds : 0;
            return timeB - timeA;
        });
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
        dragInfo.style.display = 'block';
        if (shareBtn) shareBtn.style.display = 'inline-flex'; 
    } else {
        dragInfo.style.display = 'none';
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
    
    if (dragSrcId && dragSrcId !== targetSongId && currentFilterType === 'PLAYLIST') {
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
    currentFilterType = 'ALL'; currentFilterValue = 'ALL';
    document.getElementById('sectionTitleText').innerText = "បទចម្រៀងទាំងអស់";
    document.getElementById('currentAlbumSubtitle').innerHTML = `Khmer Christian Worship Songs`;
    toggleFilterUI(false);
    renderSongs();
}

function filterByAlbum(albumName) {
    currentFilterType = 'ALBUM'; currentFilterValue = albumName; switchTab('songs');
    document.getElementById('sectionTitleText').innerHTML = escapeHtml(albumName);
    document.getElementById('currentAlbumSubtitle').innerHTML = '';
    toggleFilterUI(true);
    renderSongs();
}

function filterByPlaylist(playlistName) {
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
    currentFullscreenIndex = songIndex; updateFullScreenContent(); document.getElementById('fullScreenModal').classList.add('active');
    requestWakeLock(); 
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

function openModal(modalId) { document.getElementById(modalId).classList.add('active'); }
function closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); }

function openCreatePlaylistModal() { openModal('playlistModal'); }
function openPlaylistChooserModal(songId) {
    document.getElementById('playlistTargetSongId').value = songId;
    const listContainer = document.getElementById('existingPlaylistsList');
    const keys = Object.keys(playlists);
    if(keys.length === 0) listContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">គ្មាន Playlist ស្រាប់ទេ</div>';
    else listContainer.innerHTML = keys.map(p => `<button type="button" class="action-btn-item" onclick="addSongToPlaylist('${p}')" style="font-size:0.78rem; padding:8px 10px;"><span>📂 ${escapeHtml(p)}</span><i class="fa-solid fa-plus"></i></button>`).join('');
    openModal('playlistModal');
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

function handleShareCurrentPlaylist() {
    if (currentFilterType === 'PLAYLIST' && currentFilterValue) {
        pendingSharePlaylistName = currentFilterValue;
        openModal('sharePlaylistModal'); 
    }
}

function executeShare(type) {
    closeModal('sharePlaylistModal');
    if (type === 'pdf') {
        sharePlaylistAsPDF(pendingSharePlaylistName);
    } else {
        sharePlaylistAsImages(pendingSharePlaylistName);
    }
}

async function sharePlaylistAsPDF(playlistName) {
    const songIds = playlists[playlistName];
    if (!songIds || songIds.length === 0) return;

    const shareBtn = document.getElementById('sharePlaylistBtn');
    if (shareBtn) shareBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> រៀបចំ PDF...';
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

            const urlToUse = await getSongBlobOrDataUrl(song);
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
            if (shareBtn) shareBtn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> Share All';
            return;
        }

        const pdfBlob = doc.output('blob');
        const safeName = playlistName.replace(/[^a-zA-Z0-9\u1780-\u17FF]/g, "_");
        const pdfFile = new File([pdfBlob], `${safeName}.pdf`, { type: 'application/pdf' });

        if (shareBtn) shareBtn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> Share All';

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
        if (shareBtn) shareBtn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> Share All';
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
    const songIds = playlists[playlistName];
    if (!songIds || songIds.length === 0) return;

    const shareBtn = document.getElementById('sharePlaylistBtn');
    if (shareBtn) shareBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> រៀបចំរូបភាព...';
    showToast('កំពុងរៀបចំរូបភាព...', 'info');
    
    let filesToShare = [];
    for (let i = 0; i < songIds.length; i++) {
        const song = songsList.find(s => s.id === songIds[i]);
        if (!song) continue;

        const safeTitle = song.title ? song.title.replace(/[^a-zA-Z0-9\u1780-\u17FF]/g, "_") : 'Song';
        const fileName = `${i + 1}_${safeTitle}.jpg`; 

        try {
            let fileObj = null;
            const imgData = await getSongBlobOrDataUrl(song);
            if (!imgData) continue;

            if (imgData.startsWith('data:image')) {
                const arr = imgData.split(','); 
                const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg'; 
                const bstr = atob(arr[1]); 
                let n = bstr.length; 
                const u8arr = new Uint8Array(n); 
                while (n--) u8arr[n] = bstr.charCodeAt(n);
                fileObj = new File([new Blob([u8arr], { type: mime })], fileName, { type: mime });
            } else {
                const res = await fetch(imgData);
                const blob = await res.blob();
                fileObj = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
            }
            if (fileObj) filesToShare.push(fileObj);
        } catch (err) {}
    }

    if (shareBtn) shareBtn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> Share All';

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
            showToast('Browser របស់អ្នកមិនគាំទ្រការ Share ទេ។', 'warning');
        }
    }
}

function changeTranspose(delta) {
    currentTransposeStep += delta;
    let startIdx = keysSharp.indexOf(baseSongKey);
    if (startIdx === -1) startIdx = keysFlat.indexOf(baseSongKey);
    
    if (startIdx !== -1) {
        let newIdx = (startIdx + currentTransposeStep) % 12;
        if (newIdx < 0) newIdx += 12;
        document.getElementById('transposeLabel').innerText = keysSharp[newIdx];
    } else {
        document.getElementById('transposeLabel').innerText = currentTransposeStep > 0 ? `+${currentTransposeStep}` : currentTransposeStep;
    }
    
    const song = currentFilteredSongs[currentFullscreenIndex];
    if(song && song.lyrics) {
        renderLyricsToHTML(song.lyrics);
    }
    vibratePhone(20);
}

function transposeSingleChord(chord, steps) {
    if (steps === 0) return chord;
    const match = chord.match(/^([A-G][#b]?)(.*)$/i);
    if (!match) return chord; 

    let root = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    let modifier = match[2];

    let index = keysSharp.indexOf(root);
    let useSharp = true;
    if (index === -1) {
        index = keysFlat.indexOf(root);
        useSharp = false;
    }
    if (index === -1) return chord;

    let newIndex = (index + steps) % 12;
    if (newIndex < 0) newIndex += 12;

    let newRoot = useSharp ? keysSharp[newIndex] : keysFlat[newIndex];
    return newRoot + modifier;
}

// ---------------------------------------------------------
// ម៉ាស៊ីនបំប្លែង Lyrics ទៅជារូបភាព (Canvas សុទ្ធ អណ្តែត Chord ស្អាត)
// ---------------------------------------------------------
function generateLyricsImage(song) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const width = 800; 
        let height = 180; 
        
        const lines = (song.lyrics || '').split('\n');
        const parsedLines = [];
        
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed === '') { height += 30; parsedLines.push({ type: 'empty' }); return; }
            
            let isHeader = /^(Intro|I\.|II\.|III\.|IV\.|V\.|Pre|R1\.|R2\.|Chorus|Bridge|Instr\.)/i.test(trimmed);
            
            if (isHeader) {
                height += 70; parsedLines.push({ type: 'header', text: line });
            } else if (!line.includes('[')) {
                height += 40; parsedLines.push({ type: 'text-only', text: line });
            } else {
                height += 70; parsedLines.push({ type: 'lyric-with-chord', raw: line });
            }
        });
        
        canvas.width = width;
        canvas.height = height + 60; 
        
        // Background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Header Info
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 32px "Kantumruy Pro", sans-serif';
        ctx.fillText(song.title || 'គ្មានចំណងជើង', 40, 60);
        
        ctx.fillStyle = '#64748b';
        ctx.font = '22px "Kantumruy Pro", sans-serif';
        let printKey = baseSongKey;
        if(!printKey || printKey === "") printKey = (song.songKey || 'C').split(/[\s,/-]+/)[0].trim();
        ctx.fillText(`អ្នកចម្រៀង៖ ${song.artist || 'មិនស្គាល់'}  |  Key: ${printKey || 'C'}`, 40, 100);
        
        ctx.strokeStyle = '#d4d8e5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(40, 130);
        ctx.lineTo(width - 40, 130);
        ctx.stroke();
        
        let y = 180;
        parsedLines.forEach(pl => {
            if (pl.type === 'empty') {
                y += 30;
            } else if (pl.type === 'header') {
                const parts = pl.text.split(/\[(.*?)\]/g);
                let currentX = 40;
                
                if (parts.length === 1 && !pl.text.includes('[')) {
                    ctx.fillStyle = '#2563eb';
                    ctx.font = 'bold 26px "Kantumruy Pro", sans-serif';
                    ctx.fillText(pl.text, 40, y + 35);
                } else {
                    for(let i=0; i<parts.length; i++) {
                        if(i % 2 === 0) {
                            if (parts[i]) {
                                ctx.fillStyle = '#2563eb';
                                ctx.font = 'bold 26px "Kantumruy Pro", sans-serif';
                                ctx.fillText(parts[i], currentX, y + 35);
                                currentX += ctx.measureText(parts[i]).width;
                            }
                        } else {
                            let chord = transposeSingleChord(parts[i], currentTransposeStep || 0);
                            ctx.fillStyle = '#ef4444';
                            ctx.font = 'bold 22px Arial, sans-serif';
                            ctx.fillText(chord, currentX, y); // Chord Y
                            
                            let nextText = parts[i+1] || '';
                            ctx.fillStyle = '#2563eb';
                            ctx.font = 'bold 26px "Kantumruy Pro", sans-serif';
                            ctx.fillText(nextText, currentX, y + 35); // Text Y
                            currentX += ctx.measureText(nextText).width;
                            i++;
                        }
                    }
                }
                y += 70;
            } else if (pl.type === 'text-only') {
                ctx.fillStyle = '#0f172a';
                ctx.font = '24px "Kantumruy Pro", sans-serif';
                ctx.fillText(pl.text, 40, y + 35);
                y += 40;
            } else if (pl.type === 'lyric-with-chord') {
                const parts = pl.raw.split(/\[(.*?)\]/g);
                let currentX = 40;

                for(let i=0; i<parts.length; i++) {
                    if(i % 2 === 0) {
                        if (parts[i]) {
                            ctx.fillStyle = '#0f172a';
                            ctx.font = '24px "Kantumruy Pro", sans-serif';
                            ctx.fillText(parts[i], currentX, y + 35); // Text Y
                            currentX += ctx.measureText(parts[i]).width;
                        }
                    } else {
                        let chord = transposeSingleChord(parts[i], currentTransposeStep || 0);
                        ctx.fillStyle = '#ef4444';
                        ctx.font = 'bold 22px Arial, sans-serif';
                        ctx.fillText(chord, currentX, y); // Chord Y
                        
                        let nextText = parts[i+1] || '';
                        ctx.fillStyle = '#0f172a';
                        ctx.font = '24px "Kantumruy Pro", sans-serif';
                        ctx.fillText(nextText, currentX, y + 35); // Text Y
                        currentX += ctx.measureText(nextText).width;
                        i++;
                    }
                }
                y += 70;
            }
        });
        
        resolve(canvas.toDataURL('image/jpeg', 0.9));
    });
}

async function getSongBlobOrDataUrl(song) {
    if (song.lyrics && (!song.imageUrl || song.imageUrl.length < 10)) {
        return await generateLyricsImage(song);
    }
    return song.imageUrl;
}

async function downloadSongAction(songId) {
    const song = songsList.find(s => s.id === songId); if (!song) return;
    try {
        showToast('កំពុងរៀបចំទាញយក...', 'info');
        const imgData = await getSongBlobOrDataUrl(song);
        if(!imgData) { showToast('គ្មានទិន្នន័យសម្រាប់ទាញយកទេ', 'warning'); return; }

        const fileName = `${song.title.replace(/[^a-zA-Z0-9]/g, "_")}.jpg`;
        if (imgData.startsWith('data:image')) { 
            const a = document.createElement('a'); a.href = imgData; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); 
        } else { 
            const res = await fetch(imgData); const blob = await res.blob(); const blobUrl = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.href = blobUrl; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(blobUrl); 
        }
        showToast('ទាញយករួចរាល់', 'success');
    } catch (e) { console.log(e); showToast('បរាជ័យក្នុងការទាញយក', 'error'); }
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
    if(song.mediaUrl) { mediaBtn.style.display = 'flex'; mediaBtn.onclick = () => window.open(song.mediaUrl, '_blank'); } 
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
    const itemsToDisplay = currentFilteredSongs.slice(0, displayedItemCount);

    let html = itemsToDisplay.map((song) => {
        const inFav = (playlists['Favorite'] || []).includes(song.id);
        const keyHtml = song.songKey ? `<span class="song-key-badge">${escapeHtml(song.songKey)}</span>` : '';
        
        let cardThumbnail = '';
        if (song.imageUrl && song.imageUrl.length > 10) {
            cardThumbnail = `<img src="${song.imageUrl}" class="song-img" alt="${escapeHtml(song.title)}" loading="lazy" onclick="openFullScreenModal('${song.id}')">`;
        } else if (song.lyrics) {
            const previewText = escapeHtml(song.lyrics).replace(/\[.*?\]/g, '').substring(0, 100) + '...';
            cardThumbnail = `
                <div class="song-text-preview" onclick="openFullScreenModal('${song.id}')">
                    <div class="text-preview-header" style="font-size: 1rem;"><i class="fa-solid fa-music"></i> ${escapeHtml(song.title)}</div>
                    <div style="white-space: pre-wrap; font-family: 'Kantumruy Pro', sans-serif; color: var(--text); line-height: 1.5; margin-top: 4px;">${previewText}</div>
                </div>`;
        } else {
            cardThumbnail = `<img src="https://via.placeholder.com/300x400?text=No+Data" class="song-img" onclick="openFullScreenModal('${song.id}')">`;
        }

        return `
            <div class="song-card" id="song-card-${song.id}" ${isCustomPlaylist ? `draggable="true" ondragstart="handleDragStart(event, '${song.id}')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${song.id}')" ondragend="handleDragEnd(event)"` : ''}>
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
