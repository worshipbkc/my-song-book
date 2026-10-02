// --- ផ្នែក Metronome ---
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

// --- ផ្នែក Tuner ---
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
        
        // ----------------------------------------------------
        // កូដថ្មី៖ បន្ថែម Low-pass Filter កាត់សំឡេងរំខាន
        // ----------------------------------------------------
        const biquadFilter = tunerAudioCtx.createBiquadFilter();
        biquadFilter.type = "lowpass";
        biquadFilter.frequency.value = 800; // កាត់សំឡេងប្រេកង់ខ្ពស់ជាង 800Hz ចោល (សម្លេងខ្យល់ ឬសម្លេងស្រួចៗ)
        biquadFilter.Q.value = 1;

        // ភ្ជាប់ Microphone -> Filter -> Analyser
        microphone.connect(biquadFilter);
        biquadFilter.connect(analyser);
        // ----------------------------------------------------
        
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
