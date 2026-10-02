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
function deleteSong(songId) { 
    if (confirm('តើអ្នកពិតជាចង់លុបបទចម្រៀងនេះមែនទេ?')) { db.collection("songs").doc(songId).delete(); showToast('បានលុបរួចរាល់', 'info'); } 
}
