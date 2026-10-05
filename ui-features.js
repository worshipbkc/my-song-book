// --- ផ្នែក Share និង Export PDF/Image ---
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
            
            // 🔴 កំណត់ទំហំស្តង់ដារ A4 (មាត្រដ្ឋាន 1 : 1.414) ក្នុងកម្រិតច្បាស់ (1080p Base)
            // A4 បញ្ឈរ (Portrait) = 1080 x 1527 | A4 ផ្តេក (Landscape) = 1527 x 1080
            let width = isTwoCol ? 1527 : 1080; 
            let minHeight = isTwoCol ? 1080 : 1527; 
            
            const lines = (song.lyrics || '').split('\n');
            let totalLines = 0;
            
            lines.forEach(line => {
                if (line.trim() === '') totalLines += 0.5;
                else totalLines += 1; 
            });
            
            let linesPerCol = isTwoCol ? Math.ceil(totalLines / 2) + 2 : totalLines;
            
            // ការពារករណីបទចម្រៀងវែងពេក យើងបន្តសន្លឹកឱ្យវែងតាមហ្នឹង (PDF នឹងទាញវាឱ្យ Fit អូតូ)
            let contentHeight = (linesPerCol * 45) + 380; 
            let height = Math.max(minHeight, contentHeight); 
            
            canvas.width = width;
            canvas.height = height; 
            
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // របារចំណងជើង Playlist ខាងលើ
            if (playlistName) {
                ctx.fillStyle = isDark ? '#1e293b' : '#f1f5f9';
                ctx.fillRect(0, 0, canvas.width, 40);
                ctx.fillStyle = metaColor;
                ctx.font = 'bold 18px "Kantumruy Pro", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`📅 Playlist: ${playlistName}  |  App ចម្រៀងសរសើរដំកើងព្រះ`, width/2, 26);
                ctx.textAlign = 'left'; 
            }
            
            // ចំណងជើងបទចម្រៀង
            ctx.fillStyle = titleColor;
            ctx.font = 'bold 36px "Kantumruy Pro", sans-serif';
            ctx.fillText(song.title || 'គ្មានចំណងជើង', 60, 100);
            
            // ព័ត៌មានអ្នកចម្រៀង និង Key
            ctx.fillStyle = metaColor;
            ctx.font = '24px "Kantumruy Pro", sans-serif';
            let printKey = song.songKey || 'C';
            printKey = printKey.split(/[\s,/-]+/)[0].trim();
            ctx.fillText(`🎤 ${song.artist || 'មិនស្គាល់'}   |   🎼 Key: ${printKey}`, 60, 140);
            
            // បន្ទាត់គូសខណ្ឌ
            ctx.strokeStyle = isDark ? '#334155' : '#d4d8e5';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(60, 160);
            ctx.lineTo(width - 60, 160);
            ctx.stroke();
            
            // ការកំណត់ជួរឈរ (Columns)
            let col1X = 60;
            let col2X = isTwoCol ? (width / 2) + 40 : 650; 
            let startY = 220;
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
            
            // កំណត់ចន្លោះខាងលើ៖ បើមាន Playlist ទុក 50px សម្រាប់របារឈ្មោះ បើគ្មានទុក 0
            const topOffset = playlistName ? 50 : 0;
            
            canvas.width = img.width;
            canvas.height = img.height + topOffset;
            
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // គូររូបភាពចូល ដោយរំកិលចុះក្រោមតាមទំហំ topOffset
            if (isDark) {
                ctx.filter = 'invert(1) hue-rotate(180deg)';
                ctx.drawImage(img, 0, topOffset);
                ctx.filter = 'none'; 
            } else {
                ctx.drawImage(img, 0, topOffset);
            }
            
            // គូរតែរបារបង្ហាញឈ្មោះ Playlist ខាងលើគេ (ប្រសិនបើមានបញ្ជូនមក)
            if (playlistName) {
                ctx.fillStyle = isDark ? '#1e293b' : '#f1f5f9';
                ctx.fillRect(0, 0, canvas.width, 50);
                ctx.fillStyle = metaColor;
                ctx.font = 'bold 22px "Kantumruy Pro", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`📅 Playlist: ${playlistName}  |  App ចម្រៀងសរសើរដំកើងព្រះ`, canvas.width/2, 32);
                ctx.textAlign = 'left';
            }
            
            // លុបកូដគូរចំណងជើងបទចម្រៀងចេញ ដើម្បីកុំឱ្យជាន់គ្នានឹងរូបភាពដែលមានស្រាប់
            
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


// --- ផ្នែក ការជូនដំណឹង (Notifications) គ្រប់ទម្រង់ ---
function openNotificationModal() {
    openModal('notificationModal');
    switchNotifTab('news'); 
    loadAdminMessages();    
    renderNewSongsTab();    
}

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

function sendAdminMessage() {
    const msg = document.getElementById('adminMsgInput').value.trim();
    if(!msg) return;
    
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

function loadAdminMessages() {
    db.collection('messages').orderBy('createdAt', 'desc').limit(30).onSnapshot(snapshot => {
        const container = document.getElementById('newsListContainer');
        if (snapshot.empty) {
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

function renderNewSongsTab() {
    const container = document.getElementById('newSongsListContainer');
    if(!songsList || songsList.length === 0) {
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 60vh; color: #94a3b8;">
                <i class="fa-solid fa-music" style="font-size: 3.5rem; margin-bottom: 15px; color: #cbd5e1;"></i>
                <div style="font-size: 1.1rem; font-weight: 600; color: #64748b;">គ្មានព័ត៌មានទេ</div>
            </div>`;
        return;
    }

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

function openAcledaNotifScreen() {
    document.getElementById('acledaNotifScreen').style.display = 'block';
    document.body.classList.add('no-scroll');
    
    const dot = document.getElementById('navNotifDot');
    if(dot) dot.style.display = 'none';

    switchAcledaTab('news');
    loadAcledaAdminMessages();
    renderAcledaNewSongs();
}

function closeAcledaNotifScreen() {
    document.getElementById('acledaNotifScreen').style.display = 'none';
    document.body.classList.remove('no-scroll');
}

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
        btnNews.style.background = 'var(--primary)';
        btnNews.style.color = 'white';
        btnNews.style.border = 'none';
        btnNews.style.boxShadow = '0 4px 10px rgba(37,99,235,0.2)';
        
        btnSongs.style.background = 'var(--card-bg)';
        btnSongs.style.color = 'var(--text-muted)';
        btnSongs.style.border = '1px solid var(--border)';
        btnSongs.style.boxShadow = 'none';

        contentNews.style.display = 'flex';
        contentSongs.style.display = 'none';
    } else {
        btnSongs.style.background = 'var(--primary)';
        btnSongs.style.color = 'white';
        btnSongs.style.border = 'none';
        btnSongs.style.boxShadow = '0 4px 10px rgba(37,99,235,0.2)';
        
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
