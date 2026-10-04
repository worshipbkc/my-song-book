// =========================================
// Apple Music Style Player Logic (ជាមួយ YouTube API)
// =========================================
let currentPlayQueue = [];
let currentQueueIndex = -1;
let currentAudioType = 'html5'; 

let ytPlayer;
let isYoutubeReady = false;
let ytProgressTimer;

// ... កូដ document.addEventListener('DOMContentLoaded' ... សម្រាប់ ytplayer
document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('ytplayer')) {
        const ytDiv = document.createElement('div');
        ytDiv.id = 'ytplayer';
        ytDiv.style.cssText = 'position: fixed; bottom: 0; right: 0; width: 300px; height: 300px; z-index: -9999; opacity: 0.01; pointer-events: none;';
        document.body.appendChild(ytDiv);
    }
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
});
// ... កូដ window.onYouTubeIframeAPIReady ...

window.onYouTubeIframeAPIReady = function() {
    ytPlayer = new YT.Player('ytplayer', {
        height: '300',
        width: '300',
        videoId: '',
        playerVars: {
            'autoplay': 1, 
            'playsinline': 1,
            'controls': 0,
            'disablekb': 1,
            'fs': 0,
            'rel': 0,
            'showinfo': 0,
            'iv_load_policy': 3,
            'origin': window.location.origin
        },
        events: {
            'onReady': () => { isYoutubeReady = true; },
            'onStateChange': onPlayerStateChange,
            'onError': (e) => { 
                console.error("YouTube Error: ", e.data); 
                const durationDisplay = document.getElementById('durationDisplay');
                if (durationDisplay) durationDisplay.innerText = "Error!";
                showToast('វីដេអូនេះមិនអនុញ្ញាតឲ្យចាក់ក្រៅ YouTube ទេ', 'error');
            }
        }
    });
};
// ... កូដ function onPlayerStateChange ...
function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.ENDED) {
        playNextSong();
    } else if (event.data == YT.PlayerState.PLAYING) {
        startYtProgress();
        updatePlayButtons('<i class="fa-solid fa-pause"></i>');
    } else if (event.data == YT.PlayerState.PAUSED) {
        stopYtProgress();
        updatePlayButtons('<i class="fa-solid fa-play"></i>');
    } else if (event.data == YT.PlayerState.BUFFERING) {
        const durationDisplay = document.getElementById('durationDisplay');
        if (durationDisplay) durationDisplay.innerText = "កំពុងផ្ទុក...";
    }
}
// ... កូដ function extractYouTubeID ...
function extractYouTubeID(url) {
    let videoID = '';
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    if (match && match[7].length == 11) {
        videoID = match[7];
    }
    return videoID;
}
// ... កូដ function playFloatingAudio ...
function playFloatingAudio(songId, event) {
    if (event) event.stopPropagation();
    
    currentPlayQueue = currentFilteredSongs.length > 0 ? currentFilteredSongs : songsList;
    currentQueueIndex = currentPlayQueue.findIndex(s => s.id === songId);
    
    if (currentQueueIndex === -1) return;
    const song = currentPlayQueue[currentQueueIndex];
    if (!song.mediaUrl) return;

    const audio = document.getElementById('audioElement');
    const ytId = extractYouTubeID(song.mediaUrl);
    
    const miniTitle = document.getElementById('miniPlayerTitle');
    if (miniTitle) miniTitle.innerText = song.title || 'Unknown';
    const miniCover = document.getElementById('miniPlayerCover');
    if (miniCover) miniCover.src = (song.imageUrl && song.imageUrl.length > 10) ? song.imageUrl : 'https://via.placeholder.com/150/2563eb/ffffff?text=Worship';
    
    const fullTitle = document.getElementById('fullPlayerTitle');
    if (fullTitle) fullTitle.innerText = song.title || 'Unknown';
    const fullArtist = document.getElementById('fullPlayerArtist');
    if (fullArtist) fullArtist.innerText = song.artist || 'Unknown Artist';
    const fullCover = document.getElementById('fullPlayerCover');
    if (fullCover) fullCover.src = (song.imageUrl && song.imageUrl.length > 10) ? song.imageUrl : 'https://via.placeholder.com/600/2563eb/ffffff?text=Worship';

    const miniPlayer = document.getElementById('appleMiniPlayer');
    if (miniPlayer) miniPlayer.classList.add('active');
    
    if (ytId) {
        currentAudioType = 'youtube';
        if(audio) audio.pause(); 
        
        updateProgressBarUI(0, 0);
        updatePlayButtons('<i class="fa-solid fa-pause"></i>');
        
        if (isYoutubeReady && ytPlayer && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById(ytId);
            ytPlayer.playVideo(); 
        } else {
            showToast('កំពុងតភ្ជាប់ទៅ YouTube សូមរង់ចាំ...', 'info');
            setTimeout(() => {
                if (isYoutubeReady && ytPlayer && ytPlayer.loadVideoById) {
                    ytPlayer.loadVideoById(ytId);
                    ytPlayer.playVideo();
                }
            }, 1000);
        }
    } else {
        currentAudioType = 'html5';
        if (isYoutubeReady && ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); 
        
        if(audio) {
            audio.src = song.mediaUrl;
            audio.play().then(() => {
                updatePlayButtons('<i class="fa-solid fa-pause"></i>');
            }).catch(err => {
                showToast('មិនអាចចាក់ឯកសារសំឡេងនេះបានទេ', 'warning');
            });
        }
    }
}
// ... កូដ function toggleApplePlayPause ...
function toggleApplePlayPause(event) {
    if (event) event.stopPropagation();
    else if (window.event) window.event.stopPropagation();
    
    if (currentAudioType === 'youtube') {
        if (isYoutubeReady && ytPlayer && ytPlayer.getPlayerState) {
            const state = ytPlayer.getPlayerState();
            if (state === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
            else ytPlayer.playVideo();
        }
    } else {
        const audio = document.getElementById('audioElement');
        if (!audio || !audio.src) return;
        if (audio.paused) {
            audio.play();
            updatePlayButtons('<i class="fa-solid fa-pause"></i>');
        } else {
            audio.pause();
            updatePlayButtons('<i class="fa-solid fa-play"></i>');
        }
    }
}
// ... កូដ function updatePlayButtons ...
// ... កូដ function playNextSong ...
// ... កូដ function playPrevSong ...
// ... កូដ function openAppleFullScreenPlayer ...
// ... កូដ function closeAppleFullScreenPlayer ...
// ... កូដ function closeAppleMiniPlayer ...
// ... កូដ function formatTime ...
// ... កូដ function startYtProgress ...
// ... កូដ function stopYtProgress ...
// ... កូដ function updateProgressBarUI ...
// ... កូដ document.addEventListener('DOMContentLoaded' ... សម្រាប់ audio និង progress bar
function updatePlayButtons(htmlContent) {
    const miniBtn = document.getElementById('miniPlayPauseBtn');
    const fullBtn = document.getElementById('fullPlayPauseBtn');
    if (miniBtn) miniBtn.innerHTML = htmlContent;
    if (fullBtn) fullBtn.innerHTML = htmlContent;
    
    // បន្ថែម Logic សម្រាប់ចលនារូបភាព Cover របស់ Full Player
    const fullPlayer = document.getElementById('appleFullPlayer');
    if (fullPlayer) {
        if (htmlContent.includes('fa-pause')) {
            // បើមានពាក្យ pause មានន័យថាកំពុងលេងភ្លេង (Playing)
            fullPlayer.classList.add('is-playing');
        } else {
            // បើកំពុង Pause
            fullPlayer.classList.remove('is-playing');
        }
    }
}

function playNextSong(event) {
    if (event) event.stopPropagation();
    else if (window.event) window.event.stopPropagation();
    
    if (currentQueueIndex >= 0 && currentQueueIndex < currentPlayQueue.length - 1) {
        playFloatingAudio(currentPlayQueue[currentQueueIndex + 1].id, null);
    }
}

function playPrevSong(event) {
    if (event) event.stopPropagation();
    else if (window.event) window.event.stopPropagation();
    
    if (currentQueueIndex > 0) {
        playFloatingAudio(currentPlayQueue[currentQueueIndex - 1].id, null);
    }
}

function openAppleFullScreenPlayer() {
    const player = document.getElementById('appleFullPlayer');
    if (player) player.classList.add('active');
}

function closeAppleFullScreenPlayer() {
    const player = document.getElementById('appleFullPlayer');
    if (player) {
        player.classList.remove('active');
        player.style.transform = ''; 
    }
}

function closeAppleMiniPlayer(event) {
    if (event) event.stopPropagation();
    else if (window.event) window.event.stopPropagation();
    
    if (currentAudioType === 'youtube' && isYoutubeReady && ytPlayer.stopVideo) {
        ytPlayer.stopVideo();
    }
    const audio = document.getElementById('audioElement');
    if (audio) { audio.pause(); audio.src = ''; }
    
    const miniPlayer = document.getElementById('appleMiniPlayer');
    if (miniPlayer) miniPlayer.classList.remove('active'); 
    closeAppleFullScreenPlayer(); 
}

function formatTime(seconds) {
    if (isNaN(seconds) || !seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function startYtProgress() {
    clearInterval(ytProgressTimer);
    ytProgressTimer = setInterval(() => {
        if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration) {
            const currentTime = ytPlayer.getCurrentTime() || 0;
            const duration = ytPlayer.getDuration() || 0;
            updateProgressBarUI(currentTime, duration);
        }
    }, 500);
}

function stopYtProgress() {
    clearInterval(ytProgressTimer);
}

function updateProgressBarUI(currentTime, duration) {
    const progressBar = document.getElementById('progressBar');
    const currentTimeDisplay = document.getElementById('currentTimeDisplay');
    const durationDisplay = document.getElementById('durationDisplay');

    if (!duration || duration <= 0) {
        if (currentTimeDisplay) currentTimeDisplay.innerText = "0:00";
        if (progressBar) {
            progressBar.value = 0;
            progressBar.style.background = `rgba(0,0,0,0.1)`;
            if(document.body.classList.contains('dark-mode')) {
                progressBar.style.background = `rgba(255,255,255,0.1)`;
            }
        }
        return; 
    }

    const percent = (currentTime / duration) * 100;
    
    if (progressBar) {
        progressBar.value = percent;
        progressBar.style.background = `linear-gradient(to right, var(--text) ${percent}%, rgba(0,0,0,0.1) ${percent}%)`;
        if(document.body.classList.contains('dark-mode')){
            progressBar.style.background = `linear-gradient(to right, var(--text) ${percent}%, rgba(255,255,255,0.1) ${percent}%)`;
        }
    }

    if (currentTimeDisplay) currentTimeDisplay.innerText = formatTime(currentTime);
    if (durationDisplay) durationDisplay.innerText = "-" + formatTime(duration - currentTime);
}

document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('audioElement');
    const progressBar = document.getElementById('progressBar');
    const volumeBar = document.getElementById('volumeBar');

    if(audio) {
        audio.addEventListener('timeupdate', () => {
            if (currentAudioType === 'html5') {
                updateProgressBarUI(audio.currentTime, audio.duration);
            }
        });
        audio.addEventListener('ended', () => {
            if (currentAudioType === 'html5') playNextSong(); 
        });
    }

    if(progressBar) {
        progressBar.addEventListener('input', (e) => {
            const percent = e.target.value / 100;
            if (currentAudioType === 'youtube') {
                if (isYoutubeReady && ytPlayer.getDuration) {
                    ytPlayer.seekTo(percent * ytPlayer.getDuration(), true);
                }
            } else {
                if(audio.duration) audio.currentTime = percent * audio.duration;
            }
        });
    }
    
    if(volumeBar) {
        volumeBar.addEventListener('input', (e) => {
            const vol = e.target.value;
            if (currentAudioType === 'youtube' && isYoutubeReady && ytPlayer.setVolume) ytPlayer.setVolume(vol);
            if (audio) audio.volume = vol / 100;
            
            volumeBar.style.background = `linear-gradient(to right, var(--text) ${vol}%, rgba(0,0,0,0.1) ${vol}%)`;
            if(document.body.classList.contains('dark-mode')){
                volumeBar.style.background = `linear-gradient(to right, var(--text) ${vol}%, rgba(255,255,255,0.1) ${vol}%)`;
            }
        });
    }

    const fullPlayer = document.getElementById('appleFullPlayer');
    if (fullPlayer) {
        let startY = 0;
        let isDragging = false;

        const handleDragStart = (e, y) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            startY = y;
            isDragging = true;
            fullPlayer.style.transition = 'none';
        };

        const handleDragMove = (y) => {
            if (!isDragging) return;
            const distance = y - startY;
            if (distance > 0) fullPlayer.style.transform = `translateY(${distance}px)`;
        };

        const handleDragEnd = (y) => {
            if (!isDragging) return;
            isDragging = false;
            fullPlayer.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            
            if (y - startY > 100) closeAppleFullScreenPlayer(); 
            else fullPlayer.style.transform = ''; 
        };

        fullPlayer.addEventListener('touchstart', e => handleDragStart(e, e.touches[0].screenY), { passive: true });
        fullPlayer.addEventListener('touchmove', e => handleDragMove(e.touches[0].screenY), { passive: true });
        fullPlayer.addEventListener('touchend', e => handleDragEnd(e.changedTouches[0].screenY), { passive: true });

        fullPlayer.addEventListener('mousedown', e => handleDragStart(e, e.clientY));
        document.addEventListener('mousemove', e => handleDragMove(e.clientY));
        document.addEventListener('mouseup', e => handleDragEnd(e.clientY));
    }
});
