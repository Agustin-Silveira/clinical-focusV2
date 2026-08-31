
        // --- INITIAL STATE & DEFAULT DATA ---
        const defaultSubjects = [
            { id: 'sub_1', name: 'Farmacología', color: '#0ea5e9', minutes: 0 },
            { id: 'sub_2', name: 'Fisiopatología', color: '#ef4444', minutes: 0 },
            { id: 'sub_3', name: 'Semiología', color: '#10b981', minutes: 0 }
        ];

        // Safe Storage Wrappers for Production (GitHub Pages / Incognito Mode)
        function safeGet(key, defaultVal) {
            try { return localStorage.getItem(key) || defaultVal; } catch(e) { return defaultVal; }
        }
        function safeParse(key, defaultObj) {
            try { const val = localStorage.getItem(key); return val ? JSON.parse(val) : defaultObj; } catch(e) { return defaultObj; }
        }
        function safeSet(key, val) {
            try { localStorage.setItem(key, val); } catch(e) { console.warn("Storage restricted", e); }
        }

        let state = {
            config: safeParse('cf_config', { times: { study: 50, shortBreak: 5, longBreak: 15 } }),
            subjects: safeParse('cf_subjects', defaultSubjects),
            tasks: safeParse('cf_tasks', []),
            stats: safeParse('cf_stats', { pomodorosToday: 0, hoursToday: 0, weeklyMinutes: [0, 0, 0, 0, 0, 0, 0], lastDate: new Date().toDateString() }),
            timer: { mode: 'study', timeLeft: 0, isRunning: false, interval: null, activeSubjectId: null },
            game: safeParse('cf_game', { active: false, targetPomos: 4, currentPomos: 0, patientId: null }),
            audio: { unlocked: false },
            youtubeId: safeGet('cf_youtubeId', null)
        };

        // Validate state for new day
        const todayStr = new Date().toDateString();
        if (state.stats.lastDate !== todayStr) {
            if (new Date().getDay() === 1) state.stats.weeklyMinutes = [0, 0, 0, 0, 0, 0, 0];
            state.stats.pomodorosToday = 0;
            state.stats.hoursToday = 0;
            state.stats.lastDate = todayStr;
            saveState();
        }

        if(!state.timer.activeSubjectId && state.subjects.length > 0) {
            state.timer.activeSubjectId = state.subjects[0].id;
        }

        // --- WEB AUDIO API FOR RELIABLE BEEPS ---
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        function playVitalBeep() {
            if (!state.audio.unlocked || audioCtx.state === 'suspended') return;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            
            gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start();
            osc.stop(audioCtx.currentTime + 0.3);
        }

        function playSoftChime() {
            if (!state.audio.unlocked || audioCtx.state === 'suspended') return;
            const t = audioCtx.currentTime;
            const vol = 0.5;
            
            function createBell(freq, startTime) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                
                osc.type = 'sine'; 
                osc.frequency.setValueAtTime(freq, startTime);
                
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(vol * 0.7, startTime + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 2.5);
                
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.start(startTime);
                osc.stop(startTime + 3.0);
            }

            createBell(523.25, t);         // C5
            createBell(659.25, t + 0.4);   // E5
            createBell(783.99, t + 0.8);   // G5
        }

        // Unlock audio context on first user interaction
        document.body.addEventListener('click', () => {
            if (!state.audio.unlocked) {
                audioCtx.resume();
                state.audio.unlocked = true;
            }
        }, { once: true });

        // --- DOM ELEMENTS ---
        const els = {
            timerDisplay: document.getElementById('timer-display'),
            timerProgress: document.getElementById('timer-progress'),
            timerLabel: document.getElementById('timer-mode-label'),
            btnStart: document.getElementById('btn-start'),
            btnPause: document.getElementById('btn-pause'),
            btnSkip: document.getElementById('btn-skip'),
            modeBtns: document.querySelectorAll('.mode-btn'),
            
            subjectSelector: document.getElementById('timer-subject-selector'),
            activeSubjectName: document.getElementById('active-subject-name'),
            
            patientWard: document.getElementById('patient-ward'),
            gameSetup: document.getElementById('game-setup'),
            patientCard: document.getElementById('patient-card'),
            btnAdmit: document.getElementById('btn-admit-patient'),
            targetPomosInput: document.getElementById('target-pomodoros'),
            patientHpBar: document.getElementById('patient-hp-bar'),
            patientHpText: document.getElementById('patient-hp-text'),
            patientProgText: document.getElementById('patient-progress-text'),
            ekgLine: document.querySelector('.ekg-line'),
            patientDiagnosis: document.getElementById('patient-diagnosis'),
            
            taskList: document.getElementById('task-list'),
            taskForm: document.getElementById('task-form'),
            taskInput: document.getElementById('task-input'),
            
            statPomos: document.getElementById('stat-pomodoros'),
            statHours: document.getElementById('stat-hours'),
            
            configModal: document.getElementById('config-modal'),
            btnConfig: document.getElementById('btn-config'),
            btnCloseConfig: document.getElementById('btn-close-config'),
            btnSaveConfig: document.getElementById('btn-save-config'),
            cfgTimes: {
                study: document.getElementById('cfg-time-study'),
                short: document.getElementById('cfg-time-short'),
                long: document.getElementById('cfg-time-long')
            },
            cfgSubjectForm: document.getElementById('form-add-subject'),
            cfgSubjectList: document.getElementById('cfg-subjects-list'),
            
            ytInput: document.getElementById('youtube-input'),
            btnSetYt: document.getElementById('btn-set-youtube'),
            ytEmpty: document.getElementById('youtube-empty'),
            ytIframe: document.getElementById('youtube-iframe')
        };

        // --- YOUTUBE INTEGRATION ---
        function extractYouTubeId(url) {
            const regex = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/;
            const match = url.match(regex);
            return match && match[1].length === 11 ? match[1] : null;
        }

        function loadYouTubeVideo(id) {
            const fallbackCont = document.getElementById('youtube-fallback-container');
            const fallbackLink = document.getElementById('youtube-fallback-link');
            if (id) {
                state.youtubeId = id;
                safeSet('cf_youtubeId', id);
                els.ytEmpty.classList.add('hidden');
                els.ytIframe.classList.remove('hidden');
                els.ytIframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=0`;
                els.ytIframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-presentation allow-popups');
                if(fallbackCont && fallbackLink) {
                    fallbackLink.href = `https://www.youtube.com/watch?v=${id}`;
                    fallbackCont.classList.remove('hidden');
                }
            } else {
                els.ytEmpty.classList.remove('hidden');
                els.ytIframe.classList.add('hidden');
                els.ytIframe.src = "";
                if(fallbackCont) fallbackCont.classList.add('hidden');
            }
        }

        els.btnSetYt.addEventListener('click', () => {
            const url = els.ytInput.value.trim();
            const id = extractYouTubeId(url);
            if (id) {
                loadYouTubeVideo(id);
                els.ytInput.value = '';
            } else {
                alert('Enlace de YouTube no válido.');
            }
        });

                // --- SPOTIFY OAUTH INTEGRATION ---
        const SPOTIFY_CLIENT_ID = 'TU_SPOTIFY_CLIENT_ID'; // Reemplazar con el Client ID de Spotify Developer
        const REDIRECT_URI = window.location.href.split('#')[0]; // URL actual sin hash
        
        const spEls = {
            setup: document.getElementById('spotify-setup'),
            selector: document.getElementById('spotify-playlist-selector'),
            view: document.getElementById('spotify-view'),
            btnConnect: document.getElementById('btn-connect-spotify'),
            select: document.getElementById('spotify-select'),
            iframe: document.getElementById('spotify-iframe'),
            btnEdit: document.getElementById('btn-edit-spotify')
        };

        // Extract token from URL hash if exists
        let spotifyToken = null;
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        if (params.has('access_token')) {
            spotifyToken = params.get('access_token');
            // Clean URL
            window.history.replaceState('', document.title, window.location.pathname + window.location.search);
        }

        function loadSpotify(embedUrl) {
            safeSet('cf_spotifyUrl', embedUrl);
            spEls.setup.classList.add('hidden');
            spEls.selector.classList.add('hidden');
            spEls.view.classList.remove('hidden');
            spEls.iframe.src = embedUrl;
        }

        async function fetchPlaylists() {
            if (!spotifyToken) return;
            try {
                const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
                    headers: { 'Authorization': 'Bearer ' + spotifyToken }
                });
                if (!res.ok) {
                    if(res.status === 401) spotifyToken = null; // Token expired
                    throw new Error('Failed to fetch');
                }
                const data = await res.json();
                
                spEls.setup.classList.add('hidden');
                spEls.selector.classList.remove('hidden');
                spEls.view.classList.add('hidden');
                
                spEls.select.innerHTML = '<option value="" disabled selected>Selecciona una Playlist...</option>';
                data.items.forEach(playlist => {
                    const opt = document.createElement('option');
                    // Transform to embed URL
                    opt.value = \https://open.spotify.com/embed/playlist/\?theme=0\;
                    opt.textContent = playlist.name;
                    spEls.select.appendChild(opt);
                });
            } catch (e) {
                console.error(e);
                spEls.setup.classList.remove('hidden');
            }
        }

        spEls.btnConnect.addEventListener('click', () => {
            const scope = encodeURIComponent('playlist-read-private playlist-read-collaborative');
            const authUrl = \https://accounts.spotify.com/authorize?response_type=token&client_id=\&scope=\&redirect_uri=\\;
            window.location.href = authUrl;
        });

        spEls.select.addEventListener('change', (e) => {
            if(e.target.value) loadSpotify(e.target.value);
        });

        spEls.btnEdit.addEventListener('click', () => {
            if (spotifyToken) {
                fetchPlaylists();
            } else {
                spEls.view.classList.add('hidden');
                spEls.setup.classList.remove('hidden');
            }
        });

        const savedSpotifyUrl = safeGet('cf_spotifyUrl', 'https://open.spotify.com/embed/playlist/0vvXsWCC9xrXsKd4ZsnZiv?theme=0');
        
        if (spotifyToken) {
            fetchPlaylists();
        } else {
            spEls.view.classList.add('hidden');
            spEls.setup.classList.remove('hidden');
        }

        // --- CALENDAR INTEGRATION ---
        const calEls = {
            setup: document.getElementById('calendar-setup'),
            view: document.getElementById('calendar-view'),
            input: document.getElementById('calendar-input'),
            btnSave: document.getElementById('btn-save-calendar'),
            btnEdit: document.getElementById('btn-edit-calendar'),
            iframe: document.getElementById('calendar-iframe')
        };

        function extractCalendarId(input) {
            if (input.includes('src=')) {
                const match = input.match(/src=([^&"]+)/);
                if (match) return decodeURIComponent(match[1]);
            }
            return input.trim();
        }

        function loadCalendar(id) {
            if (id) {
                safeSet('cf_gcalId', id);
                calEls.setup.classList.add('hidden');
                calEls.view.classList.remove('hidden');
                // Construct embed URL with Agenda mode and dark-ish styling
                const url = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(id)}&mode=AGENDA&showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=0&showCalendars=0&showTz=0&bgcolor=%230f172a&color=%23039BE5`;
                calEls.iframe.src = url;
            } else {
                calEls.setup.classList.remove('hidden');
                calEls.view.classList.add('hidden');
                calEls.iframe.src = "";
            }
        }

        calEls.btnSave.addEventListener('click', () => {
            const val = calEls.input.value;
            const id = extractCalendarId(val);
            if (id) {
                loadCalendar(id);
            } else {
                alert('ID de calendario inválido');
            }
        });

        calEls.btnEdit.addEventListener('click', () => {
            calEls.setup.classList.remove('hidden');
            calEls.view.classList.add('hidden');
            calEls.input.value = safeGet('cf_gcalId', '');
        });

        const savedCal = safeGet('cf_gcalId', null);
        if (savedCal) loadCalendar(savedCal);

        // --- CHARTS ---
        let subjectChart, weeklyChart;

        function initCharts() {
            Chart.defaults.color = '#94a3b8';
            Chart.defaults.font.family = 'Inter';
            
            subjectChart = new Chart(document.getElementById('subjectChart'), {
                type: 'doughnut',
                data: getSubjectChartData(),
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: {size: 10} } } },
                    cutout: '75%', borderDarker: 0
                }
            });

            weeklyChart = new Chart(document.getElementById('weeklyChart'), {
                type: 'bar',
                data: {
                    labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
                    datasets: [{
                        label: 'Minutos', data: state.stats.weeklyMinutes, backgroundColor: '#0ea5e9', borderRadius: 4
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true, grid: { color: '#1e293b' } }, x: { grid: { display: false } } }
                }
            });
        }

        function getSubjectChartData() {
            return {
                labels: state.subjects.map(s => s.name),
                datasets: [{
                    data: state.subjects.map(s => s.minutes),
                    backgroundColor: state.subjects.map(s => s.color),
                    borderWidth: 0
                }]
            };
        }

        function updateCharts() {
            if(subjectChart) { subjectChart.data = getSubjectChartData(); subjectChart.update(); }
            if(weeklyChart) { weeklyChart.data.datasets[0].data = state.stats.weeklyMinutes; weeklyChart.update(); }
        }

        // --- CORE FUNCTIONS ---
        function saveState() {
            safeSet('cf_config', JSON.stringify(state.config));
            safeSet('cf_subjects', JSON.stringify(state.subjects));
            safeSet('cf_tasks', JSON.stringify(state.tasks));
            safeSet('cf_stats', JSON.stringify(state.stats));
            safeSet('cf_game', JSON.stringify(state.game));
        }

        function formatTime(sec) {
            const m = Math.floor(sec / 60).toString().padStart(2, '0');
            const s = (sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }
        
        // --- PIP LOGIC ---
        const pipCanvas = document.createElement('canvas');
        pipCanvas.width = 400; pipCanvas.height = 400;
        const pipCtx = pipCanvas.getContext('2d');
        const pipVideo = document.createElement('video');
        pipVideo.muted = true;
        pipVideo.playsInline = true;
        pipVideo.style.position = 'fixed';
        pipVideo.style.bottom = '0';
        pipVideo.style.right = '0';
        pipVideo.style.width = '1px';
        pipVideo.style.height = '1px';
        pipVideo.style.opacity = '0.01';
        pipVideo.style.pointerEvents = 'none';
        document.body.appendChild(pipVideo);
        
        let pipStream = null;
        function updatePiPCanvas() {
            if(!document.pictureInPictureElement) return;

            // Background
            pipCtx.fillStyle = '#020617';
            pipCtx.fillRect(0, 0, 400, 400);
            
            // Outer Ring
            pipCtx.strokeStyle = '#1e293b';
            pipCtx.lineWidth = 15;
            pipCtx.beginPath();
            pipCtx.arc(200, 200, 160, 0, Math.PI * 2);
            pipCtx.stroke();

            // Progress Ring
            const mins = state.config.times[state.timer.mode === 'short-break' ? 'shortBreak' : (state.timer.mode === 'long-break' ? 'longBreak' : 'study')];
            const total = mins * 60;
            const prog = ((total - state.timer.timeLeft) / total);
            
            pipCtx.strokeStyle = state.timer.mode === 'study' ? '#0ea5e9' : (state.timer.mode === 'short-break' ? '#10b981' : '#8b5cf6');
            pipCtx.lineCap = 'round';
            pipCtx.beginPath();
            pipCtx.arc(200, 200, 160, -Math.PI/2, (-Math.PI/2) + (Math.PI * 2 * (1 - prog)), false);
            pipCtx.stroke();

            // Text
            pipCtx.fillStyle = '#ffffff';
            pipCtx.font = 'bold 80px monospace';
            pipCtx.textAlign = 'center';
            pipCtx.textBaseline = 'middle';
            pipCtx.fillText(formatTime(state.timer.timeLeft), 200, 180);

            pipCtx.font = 'bold 20px sans-serif';
            pipCtx.fillStyle = state.timer.mode === 'study' ? '#0ea5e9' : (state.timer.mode === 'short-break' ? '#10b981' : '#8b5cf6');
            pipCtx.fillText(els.timerLabel.textContent.toUpperCase(), 200, 250);
            
            pipCtx.font = '16px sans-serif';
            pipCtx.fillStyle = '#94a3b8';
            pipCtx.fillText(els.activeSubjectName.textContent, 200, 280);
        }

        // --- TIMER LOGIC ---
        function setTimerMode(mode) {
            state.timer.mode = mode;
            state.timer.isRunning = false;
            clearInterval(state.timer.interval);
            
            const mins = state.config.times[mode === 'short-break' ? 'shortBreak' : (mode === 'long-break' ? 'longBreak' : 'study')];
            state.timer.timeLeft = mins * 60;
            
            els.modeBtns.forEach(btn => {
                if(btn.dataset.mode === mode) {
                    btn.classList.add('bg-slate-700', 'text-white');
                    btn.classList.remove('text-slate-400');
                    els.timerLabel.textContent = btn.textContent;
                } else {
                    btn.classList.remove('bg-slate-700', 'text-white');
                    btn.classList.add('text-slate-400');
                }
            });

            els.btnStart.innerHTML = '<i class="fa-solid fa-play"></i>';
            els.btnStart.classList.remove('hidden');
            els.btnPause.classList.add('hidden');
            
            updateTimerUI();
            updateAudioTheme(mode);
        }

        function updateTimerUI() {
            els.timerDisplay.textContent = formatTime(state.timer.timeLeft);
            
            const mins = state.config.times[state.timer.mode === 'short-break' ? 'shortBreak' : (state.timer.mode === 'long-break' ? 'longBreak' : 'study')];
            const total = mins * 60;
            const prog = ((total - state.timer.timeLeft) / total) * 283;
            els.timerProgress.style.strokeDashoffset = prog;
            
            els.timerProgress.style.stroke = state.timer.mode === 'study' ? '#0ea5e9' : (state.timer.mode === 'short-break' ? '#10b981' : '#8b5cf6');

            updatePiPCanvas();
            
            document.title = `${formatTime(state.timer.timeLeft)} - ClinicalFocus`;
            if (typeof syncPopup === 'function') syncPopup();
        }

        function timerTick() {
            if (state.timer.timeLeft > 0) {
                state.timer.timeLeft--;
                updateTimerUI();
                
                if (state.timer.mode === 'study' && state.timer.timeLeft % 60 === 0) {
                    const day = (new Date().getDay() + 6) % 7;
                    state.stats.weeklyMinutes[day]++;
                    state.stats.hoursToday += (1/60);
                    
                    const sub = state.subjects.find(s => s.id === state.timer.activeSubjectId);
                    if(sub) sub.minutes++;
                    
                    saveState();
                    updateCharts();
                    updateStatsUI();
                }
            } else {
                completePhase();
            }
        }

        function completePhase() {
            clearInterval(state.timer.interval);
            state.timer.isRunning = false;
            
            playSoftChime();
            
            if (state.timer.mode === 'study') {
                state.stats.pomodorosToday++;
                handleGameProgress();
                saveState();
                updateStatsUI();
                setTimerMode(state.stats.pomodorosToday % 4 === 0 ? 'long-break' : 'short-break');
            } else {
                setTimerMode('study');
            }
        }

        function syncPopup() {
            if (typeof popupWin !== 'undefined' && popupWin && !popupWin.closed) {
                const timeEl = popupWin.document.getElementById('popup-time');
                const modeEl = popupWin.document.getElementById('popup-mode');
                if (timeEl && els.timerDisplay) {
                    timeEl.textContent = els.timerDisplay.textContent;
                }
                if (modeEl) {
                    let modeTxt = state.timer.mode === 'study' ? 'EN GUARDIA' : 'EN DESCANSO';
                    if (!state.timer.isRunning) modeTxt += ' (PAUSADO)';
                    modeEl.textContent = modeTxt;
                    timeEl.style.color = state.timer.mode === 'study' ? '#38bdf8' : '#10b981';
                    
                    const screen = popupWin.document.getElementById('popup-screen');
                    if(screen) screen.style.borderColor = state.timer.mode === 'study' ? '#0ea5e9' : '#10b981';
                }
            }
        }

        els.btnStart.addEventListener('click', () => {
            if (!state.timer.isRunning) {
                state.timer.isRunning = true;
                els.btnStart.classList.add('hidden');
                els.btnPause.classList.remove('hidden');
                state.timer.interval = setInterval(timerTick, 1000);
                if (typeof audioCtx !== 'undefined' && audioCtx.state === 'suspended') audioCtx.resume();
                syncPopup();
            }
        });

        els.btnPause.addEventListener('click', () => {
            clearInterval(state.timer.interval);
            state.timer.isRunning = false;
            els.btnPause.classList.add('hidden');
            els.btnStart.classList.remove('hidden');
            els.btnStart.innerHTML = '<i class="fa-solid fa-play"></i>';
            syncPopup();
        });

        els.btnSkip.addEventListener('click', () => {
            clearInterval(state.timer.interval);
            state.timer.isRunning = false;
            completePhase();
            syncPopup();
        });

        const btnPip = document.getElementById('btn-pip');
        const iconPip = document.getElementById('icon-pip');
        let popupWin = null;
        
        btnPip.addEventListener('click', async () => {
            if (popupWin && !popupWin.closed) {
                popupWin.focus();
                return;
            }
            
            // Try Document PiP API first (Chrome 116+)
            if ('documentPictureInPicture' in window) {
                try {
                    popupWin = await window.documentPictureInPicture.requestWindow({
                        width: 320,
                        height: 220
                    });
                } catch (e) {
                    console.log('Document PiP failed, falling back to window.open', e);
                }
            }
            
            // Fallback to classic Popup
            if (!popupWin) {
                popupWin = window.open('', 'MiniReloj', 'width=320,height=220,popup=1');
            }

            if (!popupWin) {
                alert('Por favor, permite las ventanas emergentes (popups) para usar el Mini-reloj flotante.');
                return;
            }
            
            // Inject Medical Pager UI
            popupWin.document.write(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Buscapersonas Médico</title>
                    <script src="https://cdn.tailwindcss.com"><\/script>
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                    <style>
                        body { background-color: #0f172a; color: #e2e8f0; font-family: ui-sans-serif, system-ui, -apple-system; margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
                        .pager-container { background: #1e293b; border: 2px solid #334155; border-radius: 12px; padding: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; width: 90%; max-width: 300px; }
                        .screen { background: #020617; border: 2px solid #0ea5e9; border-radius: 8px; padding: 15px; margin-bottom: 15px; box-shadow: inset 0 0 10px rgba(14, 165, 233, 0.2); transition: border-color 0.3s; }
                        .time { font-size: 3rem; font-family: monospace; font-weight: bold; color: #38bdf8; text-shadow: 0 0 8px rgba(56, 189, 248, 0.6); margin: 0; line-height: 1; transition: color 0.3s; }
                        .mode { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; margin-top: 8px; font-weight: bold; }
                        .btn { background: #0ea5e9; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: background 0.2s; font-weight: bold; }
                        .btn:hover { background: #0284c7; }
                    </style>
                </head>
                <body>
                    <div class="pager-container">
                        <div class="screen" id="popup-screen">
                            <div class="time" id="popup-time">00:00</div>
                            <div class="mode" id="popup-mode">EN GUARDIA</div>
                        </div>
                        <button class="btn" id="btn-return"><i class="fa-solid fa-arrow-right-to-bracket mr-1"></i> Volver</button>
                    </div>
                    <script>
                        document.getElementById('btn-return').addEventListener('click', () => {
                            window.close();
                        });
                    <\/script>
                </body>
                </html>
            `);
            popupWin.document.close();
            
            // Cleanup on close
            popupWin.addEventListener('pagehide', () => {
                popupWin = null;
            });
        });

        els.modeBtns.forEach(btn => btn.addEventListener('click', (e) => {
            setTimerMode(e.target.id.replace('mode-', ''));
        }));

        // --- GAME (SALA DE URGENCIAS - PIXEL ART) ---
        function initGameUI() {
            if(state.game.active) {
                els.gameSetup.classList.add('hidden');
                els.patientCard.classList.remove('hidden');
                els.patientCard.classList.add('flex');
                document.getElementById('patient-id').textContent = state.game.patientId;
                updatePatientUI();
            } else {
                els.gameSetup.classList.remove('hidden');
                els.patientCard.classList.add('hidden');
                els.patientCard.classList.remove('flex');
            }
        }

        els.btnAdmit.addEventListener('click', () => {
            const pomos = parseInt(els.targetPomosInput.value);
            if(pomos > 0) {
                state.game = {
                    active: true,
                    targetPomos: pomos,
                    currentPomos: 0,
                    patientId: Math.floor(Math.random() * 900) + 100
                };
                animState.isAdmitting = true;
                animState.tomasX = -20;
                saveState();
                initGameUI();
            }
        });

        els.btnKill = document.getElementById('btn-kill-patient');
        els.btnKill.addEventListener('click', () => {
            if (confirm('¿Estás seguro de que deseas abandonar a este paciente (cancelar la guardia)? El progreso del turno se perderá.')) {
                state.game.active = false;
                state.game.currentPomos = 0;
                animState.isAdmitting = false;
                animState.isWalking = false;
                animState.tomasX = -20;
                saveState();
                initGameUI();
            }
        });

        function handleGameProgress() {
            if(!state.game.active) return;
            state.game.currentPomos++;
            updatePatientUI();
            
            if(state.game.currentPomos >= state.game.targetPomos) {
                setTimeout(() => {
                    const cel = document.getElementById('celebration');
                    cel.style.display = 'flex';
                    playSoftChime();
                    setTimeout(() => {
                        cel.style.display = 'none';
                        state.game.active = false;
                        saveState();
                        initGameUI();
                    }, 3000);
                }, 500);
            }
        }

        function updatePatientUI() {
            const pct = Math.min(100, Math.max(20, 20 + ((state.game.currentPomos / state.game.targetPomos) * 80)));
            els.patientHpBar.style.width = `${pct}%`;
            els.patientHpText.textContent = `${Math.floor(pct)}%`;
            els.patientProgText.textContent = `${state.game.currentPomos} / ${state.game.targetPomos} Ciclos`;
            
            if (pct < 40) {
                els.patientHpBar.className = 'h-full rounded-full health-bar-fill bg-clinical-red';
                els.patientDiagnosis.textContent = 'ESTADO CRÍTICO';
                els.patientDiagnosis.className = 'text-[10px] font-bold text-clinical-red font-mono mt-1';
            } else if (pct < 80) {
                els.patientHpBar.className = 'h-full rounded-full health-bar-fill bg-clinical-orange';
                els.patientDiagnosis.textContent = 'ESTABILIZÁNDOSE';
                els.patientDiagnosis.className = 'text-[10px] font-bold text-clinical-orange font-mono mt-1';
            } else {
                els.patientHpBar.className = 'h-full rounded-full health-bar-fill bg-clinical-green';
                els.patientDiagnosis.textContent = 'PREVIO AL ALTA';
                els.patientDiagnosis.className = 'text-[10px] font-bold text-clinical-green font-mono mt-1';
            }
        }

        // --- 32-BIT CANVAS ENGINE (ULTRA POLISHED) ---
        const canvas = document.getElementById('hospital-canvas');
        const ctx = canvas.getContext('2d');
        
        let animState = {
            tomasX: -100,
            isAdmitting: false,
            frame: 0
        };

        function drawRoundedRect(x, y, w, h, r, color) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, r);
            ctx.fill();
        }

        function drawMonitor(progress, active, frame) {
            drawRoundedRect(220, 30, 160, 90, 8, '#1e293b');
            drawRoundedRect(225, 35, 150, 80, 4, '#050505');

            if (!active) return;

            let bpm = 0;
            let color = '#10b981'; 
            let status = "STABLE";
            
            if (progress < 0.5) {
                bpm = 145 + Math.floor(Math.random() * 10);
                color = '#ef4444'; 
                status = "CRITICAL";
                if (frame % 20 < 10) {
                    drawRoundedRect(225, 35, 150, 80, 4, 'rgba(239, 68, 68, 0.15)');
                }
            } else if (progress < 1.0) {
                bpm = 95 + Math.floor(Math.random() * 5);
                color = '#f59e0b'; 
                status = "HEALING";
            } else {
                bpm = 72 + Math.floor(Math.random() * 3);
                status = "CLEARED";
            }

            // Glow Effect
            ctx.shadowBlur = 10;
            ctx.shadowColor = color;
            
            ctx.fillStyle = color;
            ctx.font = "bold 16px monospace";
            ctx.fillText(`HR: ${bpm}`, 235, 55);
            ctx.shadowBlur = 0; // reset for small text
            ctx.font = "10px monospace";
            ctx.fillText(status, 235, 70);

            // Glowing EKG Line
            ctx.shadowBlur = 8;
            ctx.shadowColor = color;
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            
            let startX = 235;
            let baseLine = 95;
            ctx.moveTo(startX, baseLine);
            
            let offset = (frame * 2.5) % 130; 
            for(let i=0; i<130; i++) {
                let x = startX + i;
                let y = baseLine;
                
                let pulsePos = (i + offset) % 130;
                if (pulsePos > 60 && pulsePos < 80) {
                    let t = pulsePos - 60;
                    if (t < 5) y -= t * 4;
                    else if (t < 10) y += (t-5) * 8 - 20;
                    else if (t < 15) y -= (t-10) * 4 - 20;
                }
                ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0; // Reset
        }

        function drawRoom(frame) {
            let grd = ctx.createLinearGradient(0, 0, 0, 180);
            grd.addColorStop(0, '#1e293b');
            grd.addColorStop(1, '#0f172a');
            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, 600, 180);
            
            ctx.fillStyle = '#020617';
            ctx.fillRect(0, 180, 600, 70);
            
            ctx.fillStyle = '#334155';
            ctx.fillRect(0, 175, 600, 5);

            // Window
            drawRoundedRect(40, 30, 120, 110, 4, '#0f172a');
            drawRoundedRect(45, 35, 110, 100, 2, '#000000'); 
            
            ctx.fillStyle = '#fef08a';
            ctx.beginPath(); ctx.arc(60, 50, 2, 0, 6.28); ctx.fill();
            ctx.beginPath(); ctx.arc(120, 70, 1.5, 0, 6.28); ctx.fill();
            ctx.beginPath(); ctx.arc(90, 40, 1, 0, 6.28); ctx.fill();
            
            ctx.beginPath(); ctx.arc(120, 50, 15, 0, 6.28); ctx.fill();

            ctx.fillStyle = 'rgba(14, 165, 233, 0.15)';
            ctx.beginPath(); ctx.moveTo(45, 135); ctx.lineTo(100, 35); ctx.lineTo(120, 35); ctx.lineTo(65, 135); ctx.fill();

            // Wall Clock
            ctx.fillStyle = '#1e293b';
            ctx.beginPath(); ctx.arc(440, 50, 20, 0, 6.28); ctx.fill();
            ctx.fillStyle = '#f8fafc';
            ctx.beginPath(); ctx.arc(440, 50, 16, 0, 6.28); ctx.fill();
            ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(440, 50); ctx.lineTo(440 + Math.cos(frame * 0.01) * 10, 50 + Math.sin(frame * 0.01) * 10);
            ctx.moveTo(440, 50); ctx.lineTo(440 + Math.cos(frame * 0.1) * 14, 50 + Math.sin(frame * 0.1) * 14);
            ctx.stroke();

            // Medical Posters
            drawRoundedRect(500, 30, 60, 80, 2, '#e2e8f0');
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(510, 40, 40, 30); 
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(510, 80, 40, 4); 
            ctx.fillRect(510, 90, 30, 4); 
        }

        function drawStretcher(x, y, isMoving, frame) {
            // Wheels (Spinning)
            const wheelAngle = isMoving ? frame * 0.2 : 0;
            const drawWheel = (wx, wy) => {
                ctx.fillStyle = '#1e293b';
                ctx.beginPath(); ctx.arc(wx, wy, 12, 0, 6.28); ctx.fill();
                ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(wx - Math.cos(wheelAngle)*10, wy - Math.sin(wheelAngle)*10);
                ctx.lineTo(wx + Math.cos(wheelAngle)*10, wy + Math.sin(wheelAngle)*10);
                ctx.moveTo(wx - Math.sin(wheelAngle)*10, wy + Math.cos(wheelAngle)*10);
                ctx.lineTo(wx + Math.sin(wheelAngle)*10, wy - Math.cos(wheelAngle)*10);
                ctx.stroke();
            };
            drawWheel(x + 20, y + 65);
            drawWheel(x + 160, y + 65);
            
            ctx.fillStyle = '#64748b';
            ctx.fillRect(x + 15, y + 25, 10, 40);
            ctx.fillRect(x + 155, y + 25, 10, 40);

            drawRoundedRect(x - 10, y, 200, 25, 8, '#e2e8f0');
            drawRoundedRect(x, y - 10, 40, 15, 6, '#cbd5e1');

            // IV Drip (Suero)
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(x + 175, y - 80, 4, 105);
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            drawRoundedRect(x + 170, y - 100, 14, 25, 4, 'rgba(255,255,255,0.8)');
            ctx.fillStyle = 'rgba(56, 189, 248, 0.6)';
            drawRoundedRect(x + 172, y - 90, 10, 12, 2, 'rgba(56, 189, 248, 0.6)');
            
            // Drip Drop
            const dropY = (frame % 60);
            if (dropY < 50) {
                ctx.fillStyle = '#38bdf8';
                ctx.beginPath(); ctx.arc(x + 177, y - 75 + dropY, 2, 0, 6.28); ctx.fill();
            }
        }

        function drawDoctor(x, y, isChecking, frame) {
            const breath = Math.sin(frame * 0.05) * 2;
            
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(x + 15, y + 70, 15, 45);
            ctx.fillRect(x + 35, y + 70, 15, 45);

            const coatY = y + 15 - breath;
            drawRoundedRect(x, coatY, 65, 80, 10, '#ffffff');

            const headY = y - breath;
            ctx.fillStyle = '#fcd34d';
            ctx.beginPath(); ctx.arc(x + 32, headY, 22, 0, 6.28); ctx.fill();
            
            ctx.fillStyle = '#475569';
            ctx.beginPath(); ctx.arc(x + 32, headY - 5, 23, 3.14, 0); ctx.fill();

            // Glasses
            ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.roundRect(x + 15, headY - 5, 12, 8, 2); ctx.stroke();
            ctx.beginPath(); ctx.roundRect(x + 30, headY - 5, 12, 8, 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x + 27, headY - 1); ctx.lineTo(x + 30, headY - 1); ctx.stroke();

            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(x + 20, coatY + 10); ctx.lineTo(x + 32, coatY + 40); ctx.lineTo(x + 45, coatY + 10); ctx.stroke();

            if (isChecking) {
                const armY = coatY + 30 + Math.sin(frame * 0.1) * 5;
                drawRoundedRect(x - 20, armY, 40, 15, 8, '#ffffff'); 
                ctx.fillStyle = '#fcd34d'; 
                ctx.beginPath(); ctx.arc(x - 25, armY + 7, 8, 0, 6.28); ctx.fill();
            } else {
                drawRoundedRect(x + 25, coatY + 15, 15, 50, 8, '#ffffff');
            }
        }

        function drawNurseTomas(x, y, isMoving, frame) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 10px monospace';
            ctx.fillText('Tomás', x + 15, y - 10);
            const breath = Math.sin(frame * 0.08) * 3;
            const walkY = isMoving ? Math.abs(Math.sin(frame * 0.2)) * 5 : 0;
            
            ctx.fillStyle = '#0284c7';
            ctx.fillRect(x + 10, y + 70 - walkY, 15, 45 + walkY);
            ctx.fillRect(x + 30, y + 70 + walkY, 15, 45 - walkY);

            const bodyY = y + 15 - breath - walkY*0.5;
            drawRoundedRect(x, bodyY, 55, 65, 10, '#0ea5e9');

            const headY = y - breath - walkY*0.5;
            ctx.fillStyle = '#fb923c';
            ctx.beginPath(); ctx.arc(x + 27, headY, 20, 0, 6.28); ctx.fill();
            
            ctx.fillStyle = '#0f172a';
            ctx.beginPath(); ctx.arc(x + 27, headY - 4, 21, 3.14, 0); ctx.fill();
            
            // Mask
            ctx.fillStyle = '#bae6fd';
            ctx.fillRect(x + 12, headY + 5, 30, 12);
            
            // Eyes
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(x + 20, headY - 2, 2, 0, 6.28); ctx.fill();
            ctx.beginPath(); ctx.arc(x + 34, headY - 2, 2, 0, 6.28); ctx.fill();

            drawRoundedRect(x + 40, bodyY + 20, 30, 15, 8, '#0ea5e9');
        }

        function drawPatient(x, y, stateIndex, frame) {
            const skin = '#fde68a';
            const gown = '#38bdf8';
            const breath = Math.sin(frame * (stateIndex === 1 ? 0.03 : 0.06)) * (stateIndex === 1 ? 1 : 3); 

            if (stateIndex === 1) {
                const headY = y - 5;
                ctx.fillStyle = skin;
                ctx.beginPath(); ctx.arc(x + 25, headY, 18, 0, 6.28); ctx.fill();
                
                // Eyes closed (suffering)
                ctx.strokeStyle = '#b45309'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x + 18, headY - 3); ctx.lineTo(x + 24, headY - 1); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x + 28, headY - 1); ctx.lineTo(x + 34, headY - 3); ctx.stroke();

                // Sweat
                ctx.fillStyle = 'rgba(56, 189, 248, 0.8)';
                ctx.beginPath(); ctx.arc(x + 15, headY - 10, 2, 0, 6.28); ctx.fill();

                drawRoundedRect(x + 45, y - 15 - breath, 130, 35 + breath, 10, '#bfdbfe'); 
                
                if (frame % 20 < 10) {
                    ctx.shadowBlur = 15; ctx.shadowColor = '#ef4444';
                    ctx.fillStyle = '#ef4444';
                    ctx.fillRect(x + 20, y - 45, 10, 25);
                    ctx.fillRect(x + 12, y - 37, 25, 10);
                    ctx.shadowBlur = 0;
                }

            } else if (stateIndex === 2) {
                const bodyY = y - 65 - breath;
                drawRoundedRect(x + 50, bodyY, 40, 65 + breath, 10, gown); 
                
                const headY = bodyY - 20;
                ctx.fillStyle = skin;
                ctx.beginPath(); ctx.arc(x + 70, headY, 18, 0, 6.28); ctx.fill(); 
                
                // Open eyes
                ctx.fillStyle = '#000';
                ctx.beginPath(); ctx.arc(x + 63, headY - 2, 2, 0, 6.28); ctx.fill();
                ctx.beginPath(); ctx.arc(x + 77, headY - 2, 2, 0, 6.28); ctx.fill();
                
                drawRoundedRect(x + 60, y, 15, 45, 8, skin); 

            } else if (stateIndex === 3) {
                const standX = x + 230;
                const standY = y - 40;
                
                ctx.fillStyle = skin;
                ctx.fillRect(standX + 10, standY + 60, 12, 55);
                ctx.fillRect(standX + 30, standY + 60, 12, 55);
                
                const bodyY = standY + 15 - breath;
                drawRoundedRect(standX, bodyY, 52, 60, 10, gown);
                
                const headY = bodyY - 15;
                ctx.fillStyle = skin;
                ctx.beginPath(); ctx.arc(standX + 26, headY, 18, 0, 6.28); ctx.fill();

                // Happy eyes and smile
                ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(standX + 20, headY - 2, 3, 3.14, 0); ctx.stroke();
                ctx.beginPath(); ctx.arc(standX + 32, headY - 2, 3, 3.14, 0); ctx.stroke();
                ctx.beginPath(); ctx.arc(standX + 26, headY + 5, 5, 0, 3.14); ctx.stroke();

                const armOffset = Math.sin(frame * 0.2) * 5;
                drawRoundedRect(standX - 15, bodyY - 5 + armOffset, 20, 45, 8, gown);
                drawRoundedRect(standX + 47, bodyY - 5 + armOffset, 20, 45, 8, gown);

                if (frame % 20 < 10) {
                    ctx.shadowBlur = 15; ctx.shadowColor = '#10b981';
                    ctx.fillStyle = '#10b981';
                    ctx.fillRect(standX + 22, standY - 45, 8, 20);
                    ctx.fillRect(standX + 16, standY - 39, 20, 8);
                    ctx.shadowBlur = 0;
                }
            }
        }

        function gameLoop() {
            animState.frame++;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            drawRoom(animState.frame);

            if (state.game.active) {
                const progress = state.game.currentPomos / state.game.targetPomos;
                
                drawMonitor(progress, true, animState.frame);

                if (animState.isAdmitting) {
                    animState.tomasX += 4; 
                    if (animState.tomasX >= 180) {
                        animState.tomasX = 180;
                        animState.isAdmitting = false; 
                    }
                    
                    drawNurseTomas(animState.tomasX - 80, 75, true, animState.frame);
                    drawStretcher(animState.tomasX, 125, true, animState.frame);
                    drawPatient(animState.tomasX, 125, 1, animState.frame);
                    
                } else {
                    drawStretcher(180, 125, false, animState.frame);
                    
                    const isChecking = (progress >= 0.5 && progress < 1.0);
                    drawDoctor(450, 75, isChecking, animState.frame);

                    if (progress < 0.5) {
                        drawPatient(180, 125, 1, animState.frame);
                    } else if (progress < 1.0) {
                        drawPatient(180, 125, 2, animState.frame);
                    } else {
                        drawPatient(180, 125, 3, animState.frame);
                    }
                }
            } else {
                drawMonitor(0, false, animState.frame);
            }

            requestAnimationFrame(gameLoop);
        }
        
        gameLoop();

        function updateAudioTheme(mode) {
            const b = document.body;
            if(mode === 'study') {
                b.style.backgroundColor = '#0f172a';
            } else {
                b.style.backgroundColor = '#020617';
            }
        }

        // --- SUBJECTS UI ---
        function renderSubjectsUI() {
            els.subjectSelector.innerHTML = '';
            
            if(state.subjects.length === 0) {
                els.activeSubjectName.textContent = 'Ninguna';
                state.timer.activeSubjectId = null;
                return;
            }

            if(!state.subjects.find(s => s.id === state.timer.activeSubjectId)) {
                state.timer.activeSubjectId = state.subjects[0].id;
            }

            const activeSub = state.subjects.find(s => s.id === state.timer.activeSubjectId);
            els.activeSubjectName.textContent = activeSub.name;
            els.activeSubjectName.style.color = activeSub.color;

            state.subjects.forEach(sub => {
                const isActive = sub.id === state.timer.activeSubjectId;
                const btn = document.createElement('button');
                btn.className = `flex flex-col items-center py-1.5 px-3 rounded-lg border transition ${isActive ? '' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`;
                
                const nameSpan = document.createElement('span');
                nameSpan.className = "text-[11px] font-medium";
                nameSpan.textContent = sub.name;
                
                const hrsSpan = document.createElement('span');
                hrsSpan.className = "text-[9px] opacity-70 mt-0.5";
                hrsSpan.innerHTML = `<i class="fa-solid fa-clock-rotate-left mr-1"></i>${(sub.minutes/60).toFixed(1)}h`;

                btn.appendChild(nameSpan);
                btn.appendChild(hrsSpan);

                if(isActive) {
                    btn.style.backgroundColor = `${sub.color}20`;
                    btn.style.color = sub.color;
                    btn.style.borderColor = sub.color;
                }
                btn.onclick = () => {
                    state.timer.activeSubjectId = sub.id;
                    renderSubjectsUI();
                };
                els.subjectSelector.appendChild(btn);
            });
            updateCharts();
        }

        // --- TASKS (HISTORIA CLÍNICA) ---
        function renderTasks() {
            els.taskList.innerHTML = '';
            if (state.tasks.length === 0) {
                els.taskList.innerHTML = '<div class="text-sm text-slate-500 text-center mt-10 italic">Sin evoluciones. Paciente estable.</div>';
                return;
            }
            
            state.tasks.forEach((task, idx) => {
                const div = document.createElement('div');
                div.className = `flex items-center gap-3 p-3 mb-2 rounded border ${task.completed ? 'border-slate-800 bg-slate-900/40 task-completed' : 'border-slate-700 bg-slate-800/80'} transition-all`;
                
                let pagesHtml = '';
                if (task.hasPages) {
                    pagesHtml = `
                        <div class="flex items-center gap-1.5 ml-2 bg-slate-900 px-2 py-1 rounded border border-slate-700">
                            <button class="w-5 h-5 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-[10px] text-white transition" onclick="updateTaskPages(${idx}, -1)"><i class="fa-solid fa-minus"></i></button>
                            <span class="text-xs font-mono w-6 text-center text-clinical-blue font-bold">${task.pages || 0}</span>
                            <button class="w-5 h-5 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-[10px] text-white transition" onclick="updateTaskPages(${idx}, 1)"><i class="fa-solid fa-plus"></i></button>
                        </div>
                    `;
                }

                div.innerHTML = `
                    <button class="mt-0.5 text-lg ${task.completed ? 'text-clinical-green' : 'text-slate-500 hover:text-clinical-blue'}" onclick="toggleTask(${idx})">
                        <i class="fa-${task.completed ? 'solid fa-check-circle' : 'regular fa-circle'}"></i>
                    </button>
                    <div class="flex-grow">
                        <p class="text-sm ${task.completed ? 'text-slate-500' : 'text-slate-200'}">${task.text}</p>
                        <p class="text-[10px] text-slate-500 mt-1 font-mono">${task.date}</p>
                    </div>
                    ${pagesHtml}
                    <button class="text-slate-600 hover:text-clinical-red transition ml-2" onclick="deleteTask(${idx})">
                        <i class="fa-solid fa-trash-can text-sm"></i>
                    </button>
                `;
                els.taskList.appendChild(div);
            });
        }

        els.taskForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const val = els.taskInput.value.trim();
            const hasPages = document.getElementById('task-pages-check').checked;
            if(val) {
                state.tasks.unshift({ 
                    text: val, 
                    completed: false, 
                    date: new Date().toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}),
                    hasPages: hasPages,
                    pages: 0
                });
                els.taskInput.value = '';
                document.getElementById('task-pages-check').checked = false;
                saveState();
                renderTasks();
            }
        });

        window.toggleTask = (idx) => { state.tasks[idx].completed = !state.tasks[idx].completed; saveState(); renderTasks(); };
        window.deleteTask = (idx) => { state.tasks.splice(idx, 1); saveState(); renderTasks(); };
        window.updateTaskPages = (idx, delta) => { 
            state.tasks[idx].pages = Math.max(0, (state.tasks[idx].pages || 0) + delta);
            saveState();
            renderTasks();
        };
        
        document.getElementById('btn-clear-tasks').addEventListener('click', () => {
            if(confirm('¿Eliminar todas las evoluciones médicas?')) {
                state.tasks = [];
                saveState();
                renderTasks();
            }
        });

        // --- STATS ---
        function updateStatsUI() {
            els.statPomos.textContent = state.stats.pomodorosToday;
            els.statHours.textContent = state.stats.hoursToday.toFixed(1);
        }
        
        document.getElementById('btn-reset-stats').addEventListener('click', () => {
            if(confirm('¿ATENCIÓN: Estás seguro de reiniciar todas las estadísticas a cero? Esto borrará tus progresos y no se puede deshacer.')) {
                state.stats = {
                    pomodorosToday: 0, hoursToday: 0,
                    weeklyMinutes: [0, 0, 0, 0, 0, 0, 0],
                    lastDate: new Date().toDateString()
                };
                state.subjects.forEach(s => s.minutes = 0);
                saveState();
                updateStatsUI();
                updateCharts();
                alert('Tus estadísticas clínicas han sido reiniciadas.');
            }
        });

        // --- CONFIGURATION MODAL ---
        els.btnConfig.addEventListener('click', () => {
            els.cfgTimes.study.value = state.config.times.study;
            els.cfgTimes.short.value = state.config.times.shortBreak;
            els.cfgTimes.long.value = state.config.times.longBreak;
            renderConfigSubjects();
            els.configModal.classList.remove('hidden');
        });

        els.btnCloseConfig.addEventListener('click', () => els.configModal.classList.add('hidden'));

        function renderConfigSubjects() {
            els.cfgSubjectList.innerHTML = '';
            state.subjects.forEach((sub, idx) => {
                const div = document.createElement('div');
                div.className = "flex justify-between items-center bg-slate-800 p-2 rounded border border-slate-700";
                div.innerHTML = `
                    <div class="flex items-center gap-2">
                        <div class="w-3 h-3 rounded-full" style="background-color: ${sub.color}"></div>
                        <input type="text" class="bg-transparent text-sm text-white focus:outline-none focus:border-b border-clinical-blue" value="${sub.name}" onchange="updateSubName('${sub.id}', this.value)">
                    </div>
                    <button onclick="deleteSub('${sub.id}')" class="text-slate-500 hover:text-clinical-red"><i class="fa-solid fa-xmark"></i></button>
                `;
                els.cfgSubjectList.appendChild(div);
            });
        }

        window.updateSubName = (id, newName) => {
            const sub = state.subjects.find(s => s.id === id);
            if(sub) sub.name = newName;
        };

        window.deleteSub = (id) => {
            state.subjects = state.subjects.filter(s => s.id !== id);
            renderConfigSubjects();
        };

        // --- SUBJECT PALETTE RENDER ---
        function renderSubjectPalette() {
            const container = document.getElementById('palette-subject');
            const inputEl = document.getElementById('cfg-subject-color');
            const colorList = ['#0ea5e9', '#10b981', '#8b5cf6', '#f97316', '#f472b6', '#06b6d4', '#f43f5e', '#f59e0b', '#1e293b', '#475569'];
            let currentColor = inputEl.value;
            
            container.innerHTML = '';
            colorList.forEach(color => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 border-2 ${currentColor === color ? 'border-white scale-110 shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'border-transparent'}`;
                btn.style.backgroundColor = color;
                btn.addEventListener('click', () => {
                    inputEl.value = color;
                    renderSubjectPalette();
                });
                container.appendChild(btn);
            });
        }
        renderSubjectPalette();

        els.cfgSubjectForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('cfg-subject-name').value.trim();
            const color = document.getElementById('cfg-subject-color').value;
            if(name) {
                state.subjects.push({ id: 'sub_' + Date.now(), name, color, minutes: 0 });
                document.getElementById('cfg-subject-name').value = '';
                // Optional: Randomize next color
                const colorList = ['#0ea5e9', '#10b981', '#8b5cf6', '#f97316', '#f472b6', '#06b6d4', '#f43f5e', '#f59e0b', '#1e293b', '#475569'];
                document.getElementById('cfg-subject-color').value = colorList[Math.floor(Math.random() * colorList.length)];
                renderSubjectPalette();
                renderConfigSubjects();
            }
        });

        els.btnSaveConfig.addEventListener('click', () => {
            state.config.times.study = parseInt(els.cfgTimes.study.value) || 50;
            state.config.times.shortBreak = parseInt(els.cfgTimes.short.value) || 5;
            state.config.times.longBreak = parseInt(els.cfgTimes.long.value) || 15;
            
            saveState();
            
            if(!state.timer.isRunning) setTimerMode(state.timer.mode);
            
            renderSubjectsUI();
            els.configModal.classList.add('hidden');
        });

        // --- HOLIDAYS LOGIC (Córdoba, Argentina) ---
        const holidays = [
            { month: 1, day: 1, name: "Año Nuevo" },
            { month: 3, day: 24, name: "Día Nac. de la Memoria por la Verdad y la Justicia" },
            { month: 4, day: 2, name: "Día del Veterano y de los Caídos en Malvinas" },
            { month: 5, day: 1, name: "Día del Trabajador" },
            { month: 5, day: 25, name: "Día de la Revolución de Mayo" },
            { month: 6, day: 20, name: "Paso a la Inmortalidad del Gral. Manuel Belgrano" },
            { month: 7, day: 6, name: "Fundación de Córdoba" },
            { month: 7, day: 9, name: "Día de la Independencia" },
            { month: 9, day: 30, name: "Día de San Jerónimo" },
            { month: 12, day: 8, name: "Inmaculada Concepción de María" },
            { month: 12, day: 25, name: "Navidad" }
        ];

        function initHolidayWidget() {
            const today = new Date();
            today.setHours(0,0,0,0);
            const currentYear = today.getFullYear();
            
            let nextHoliday = null;
            let minDiff = Infinity;
            let finalDate = null;
            
            for (let year = currentYear; year <= currentYear + 1; year++) {
                for (let h of holidays) {
                    const hDate = new Date(year, h.month - 1, h.day);
                    const diffTime = hDate - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    
                    if (diffDays >= 0 && diffDays < minDiff) {
                        minDiff = diffDays;
                        nextHoliday = h;
                        finalDate = hDate;
                    }
                }
            }
            
            if (nextHoliday) {
                document.getElementById('holiday-name').textContent = nextHoliday.name;
                const options = { weekday: 'long', day: 'numeric', month: 'long' };
                document.getElementById('holiday-date').textContent = finalDate.toLocaleDateString('es-ES', options);
                
                if (minDiff === 0) {
                    document.getElementById('holiday-countdown').textContent = "¡ES HOY!";
                } else if (minDiff === 1) {
                    document.getElementById('holiday-countdown').textContent = "Mañana";
                } else {
                    document.getElementById('holiday-countdown').textContent = minDiff + " días";
                }
            }
        }

        // --- INIT ---
        setInterval(() => {
            const now = new Date();
            const cTime = document.getElementById('current-time');
            const cDate = document.getElementById('current-date');
            if(cTime) cTime.textContent = now.toLocaleTimeString('es-ES', { hour12: false });
            if(cDate) cDate.textContent = now.toLocaleDateString('es-ES', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        }, 1000);

        initHolidayWidget();
        initCharts();
        renderSubjectsUI();
        renderTasks();
        updateStatsUI();
        initGameUI();
        // Update Holiday Widget periodically
        setInterval(initHolidayWidget, 1000 * 60 * 60);

        // --- MULTIPLAYER (PEERJS) ---
        let peer = null;
        let peerConnection = null;

        let isChatMinimized = false;
        const peerEls = {
            fab: document.getElementById('btn-chat-fab'),
            fabBadge: document.getElementById('chat-fab-badge'),
            statusTxt: document.getElementById('peer-status-text'),
            led: document.getElementById('peer-led'),
            myIdInput: document.getElementById('my-peer-id'),
            btnCopy: document.getElementById('btn-copy-peer'),
            friendInput: document.getElementById('friend-peer-id'),
            btnConnect: document.getElementById('btn-connect-peer'),
            btnToggleSetup: document.getElementById('btn-toggle-peer-setup'),
            iconToggleSetup: document.getElementById('icon-toggle-peer'),
            setupContainer: document.getElementById('peer-setup-container'),
            
            nameInput: document.getElementById('my-peer-name'),
            avatarUpload: document.getElementById('my-avatar-upload'),
            myAvatarImg: document.getElementById('my-avatar-img'),
            
            card: document.getElementById('remote-peer-card'),
            remoteName: document.getElementById('remote-name'),
            remoteAvatarImg: document.getElementById('remote-avatar-img'),
            remoteAvatarIcon: document.getElementById('remote-avatar-icon'),
            timer: document.getElementById('remote-timer'),
            subject: document.getElementById('remote-subject'),
            hours: document.getElementById('remote-hours'),
            progressBar: document.getElementById('remote-progress-bar'),
            mode: document.getElementById('remote-mode'),
            
            // Remote patient
            remotePatientContainer: document.getElementById('remote-patient-container'),
            remotePatientSprite: document.getElementById('remote-patient-sprite'),
            remotePatientId: document.getElementById('remote-patient-id'),
            remotePatientHpText: document.getElementById('remote-patient-hp-text'),
            remotePatientHpBar: document.getElementById('remote-patient-hp-bar'),
            
            chatContainer: document.getElementById('floating-chat-widget'),
            chatWindow: document.getElementById('chat-window'),
            chatFab: document.getElementById('chat-fab'),
            chatBadge: document.getElementById('chat-badge'),
            btnChatSettings: document.getElementById('btn-chat-settings'),
            btnChatMinimize: document.getElementById('btn-chat-minimize'),
            chatSettingsPanel: document.getElementById('chat-settings-panel'),
            colorBg: document.getElementById('chat-color-bg'),
            colorMe: document.getElementById('chat-color-me'),
            colorThem: document.getElementById('chat-color-them'),
            chatMessages: document.getElementById('peer-chat-messages'),
            chatForm: document.getElementById('peer-chat-form'),
            chatInput: document.getElementById('peer-chat-input')
        };

        // Peer Setup Toggle Logic
        let isPeerSetupOpen = true;
        peerEls.btnToggleSetup.addEventListener('click', () => {
            isPeerSetupOpen = !isPeerSetupOpen;
            if (isPeerSetupOpen) {
                peerEls.setupContainer.style.height = peerEls.setupContainer.scrollHeight + 'px';
                peerEls.setupContainer.style.opacity = '1';
                peerEls.setupContainer.style.marginTop = '0.75rem';
                peerEls.setupContainer.style.paddingTop = '0.75rem';
                peerEls.setupContainer.style.borderTopWidth = '1px';
                peerEls.iconToggleSetup.classList.remove('rotate-180');
            } else {
                peerEls.setupContainer.style.height = '0px';
                peerEls.setupContainer.style.opacity = '0';
                peerEls.setupContainer.style.marginTop = '0px';
                peerEls.setupContainer.style.paddingTop = '0px';
                peerEls.setupContainer.style.borderTopWidth = '0px';
                peerEls.iconToggleSetup.classList.add('rotate-180');
            }
        });
        
        // Auto-set height after a tiny delay to allow CSS transitions to work
        setTimeout(() => {
            peerEls.setupContainer.style.height = peerEls.setupContainer.scrollHeight + 'px';
        }, 100);

        // Chat State
        let isChatOpen = false;
        let unreadChatCount = 0;

        // Load Chat Colors
        const chatColors = safeParse('cf_chatColors', { bg: '#0f172a', me: '#0ea5e9', them: '#1e293b' });
        
        const PRESET_COLORS = {
            bg: ['#0f172a', '#171717', '#1e1b4b', '#064e3b', '#450a0a', '#1e293b'],
            bubbles: ['#0ea5e9', '#10b981', '#8b5cf6', '#f97316', '#f472b6', '#06b6d4', '#f43f5e', '#f59e0b', '#1e293b', '#475569']
        };

        function renderPalette(containerId, inputEl, colorList, currentColor, type) {
            const container = document.getElementById(containerId);
            container.innerHTML = '';
            colorList.forEach(color => {
                const btn = document.createElement('button');
                btn.className = `w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 border-2 ${currentColor === color ? 'border-white scale-110 shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'border-transparent'}`;
                btn.style.backgroundColor = color;
                btn.addEventListener('click', () => {
                    inputEl.value = color;
                    chatColors[type] = color;
                    safeSet('cf_chatColors', chatColors);
                    applyChatColors();
                    renderPalette(containerId, inputEl, colorList, color, type); // Re-render to update selected border
                });
                container.appendChild(btn);
            });
        }

        function applyChatColors() {
            peerEls.colorBg.value = chatColors.bg;
            peerEls.colorMe.value = chatColors.me;
            peerEls.colorThem.value = chatColors.them;
            
            // convert hex to rgb for background opacity
            const hexToRgb = hex => {
                if(!hex) return '15,23,42';
                hex = hex.replace('#', '');
                if(hex.length === 3) hex = hex.split('').map(x => x+x).join('');
                const r = parseInt(hex.slice(0,2), 16);
                const g = parseInt(hex.slice(2,4), 16);
                const b = parseInt(hex.slice(4,6), 16);
                return `${r},${g},${b}`;
            };
            peerEls.chatContainer.style.setProperty('--chat-bg-rgb', hexToRgb(chatColors.bg));
            peerEls.chatContainer.style.setProperty('--chat-me', chatColors.me);
            peerEls.chatContainer.style.setProperty('--chat-them', chatColors.them);
        }
        
        applyChatColors();
        renderPalette('palette-bg', peerEls.colorBg, PRESET_COLORS.bg, chatColors.bg, 'bg');
        renderPalette('palette-me', peerEls.colorMe, PRESET_COLORS.bubbles, chatColors.me, 'me');
        renderPalette('palette-them', peerEls.colorThem, PRESET_COLORS.bubbles, chatColors.them, 'them');

        // Settings events
        peerEls.btnChatSettings.addEventListener('click', () => {
            peerEls.chatSettingsPanel.classList.toggle('hidden');
            peerEls.chatSettingsPanel.classList.toggle('flex');
        });

        // Chat minimize/maximize logic
        peerEls.btnChatMinimize.addEventListener('click', () => {
                isChatMinimized = true;
                peerEls.window.classList.add('scale-0', 'opacity-0');
                peerEls.window.classList.remove('scale-100', 'opacity-100');
                setTimeout(() => { peerEls.window.classList.add('hidden'); peerEls.fab.classList.remove('hidden'); }, 300);
            });
            peerEls.fab.addEventListener('click', () => {
                isChatMinimized = false;
                peerEls.fabBadge.classList.add('hidden');
                peerEls.fab.classList.add('hidden');
                peerEls.window.classList.remove('hidden');
                setTimeout(() => { peerEls.window.classList.add('scale-100', 'opacity-100'); peerEls.window.classList.remove('scale-0', 'opacity-0'); }, 10);
            });
            // 
            isChatOpen = false;
            peerEls.chatWindow.classList.add('scale-0', 'opacity-0');
            setTimeout(() => {
                peerEls.chatWindow.classList.add('hidden');
                peerEls.chatFab.classList.remove('hidden');
                setTimeout(() => peerEls.chatFab.classList.remove('scale-0'), 50);
            }, 300);
        });

        peerEls.chatFab.addEventListener('click', () => {
            isChatOpen = true;
            unreadChatCount = 0;
            updateChatBadge();
            peerEls.chatFab.classList.add('scale-0');
            setTimeout(() => {
                peerEls.chatFab.classList.add('hidden');
                peerEls.chatWindow.classList.remove('hidden');
                setTimeout(() => {
                    peerEls.chatWindow.classList.remove('scale-0', 'opacity-0');
                    peerEls.chatMessages.scrollTop = peerEls.chatMessages.scrollHeight;
                }, 50);
            }, 300);
        });

        function updateChatBadge() {
            if(unreadChatCount > 0 && !isChatOpen) {
                peerEls.chatBadge.textContent = unreadChatCount > 9 ? '9+' : unreadChatCount;
                peerEls.chatBadge.classList.remove('hidden');
                setTimeout(() => peerEls.chatBadge.classList.remove('scale-0'), 50);
            } else {
                peerEls.chatBadge.classList.add('scale-0');
                setTimeout(() => peerEls.chatBadge.classList.add('hidden'), 300);
            }
        }

        function playPagerSound() {
            if(typeof audioCtx === 'undefined') return;
            if(audioCtx.state === 'suspended') audioCtx.resume();
            try {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(900, audioCtx.currentTime);
                osc.frequency.setValueAtTime(1300, audioCtx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.2);
            } catch(e) {}
        }

        function playFuerzasSound() {
            if(typeof audioCtx === 'undefined') return;
            if(audioCtx.state === 'suspended') audioCtx.resume();
            try {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
                osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1); // E5
                osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2); // G5
                osc.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.3); // C6
                
                gain.gain.setValueAtTime(0, audioCtx.currentTime);
                gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1);
                
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 1);
            } catch(e) {}
        }

        function showFuerzasToast(senderName, message) {
            playFuerzasSound();
            const toast = document.createElement('div');
            toast.className = 'fixed top-1/4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-slate-900/90 border border-clinical-yellow text-clinical-yellow px-6 py-4 rounded-2xl shadow-[0_0_30px_rgba(234,179,8,0.4)] z-[100] flex items-center gap-3 animate-bounce-in backdrop-blur-md';
            toast.innerHTML = `<i class="fa-solid fa-bolt text-2xl animate-pulse"></i><div><p class="font-bold text-sm">¡${senderName} te manda Fuerzas! 💪</p><p class="text-[10px] text-slate-300">${message || '¡Sigue así, no te rindas!'}</p></div>`;
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.classList.add('opacity-0', 'scale-90', 'transition-all', 'duration-500');
                setTimeout(() => toast.remove(), 500);
            }, 3000);
        }

        const btnFuerzas = document.getElementById('btn-fuerzas');
        if (btnFuerzas) {
            const frasesMotivacionales = [
                "¡Un pomodoro menos para el final! ⏱️",
                "¡Esa materia se aprueba! 📚",
                "¡Excelente pase de guardia! 🩺",
                "¡Signos vitales de estudio estables, a seguir! 📈",
                "¡Café en vena y a continuar! ☕",
                "¡Sigue así, futuro colega! 🌟",
                "¡Diagnóstico: Éxito inminente! 🧠"
            ];
            
            btnFuerzas.addEventListener('click', () => {
                if (!peerConnection || btnFuerzas.disabled) return;
                
                // Cooldown
                btnFuerzas.disabled = true;
                const originalHtml = btnFuerzas.innerHTML;
                btnFuerzas.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                btnFuerzas.classList.add('opacity-50', 'cursor-not-allowed');
                
                const myName = peerEls.nameInput.value.trim() || 'Un colega';
                const frase = frasesMotivacionales[Math.floor(Math.random() * frasesMotivacionales.length)];
                
                peerConnection.send({ type: 'fuerzas', sender: myName, message: frase });
                
                setTimeout(() => {
                    btnFuerzas.disabled = false;
                    btnFuerzas.innerHTML = originalHtml;
                    btnFuerzas.classList.remove('opacity-50', 'cursor-not-allowed');
                }, 2000);
            });
        }

        // Load saved Profile
        const savedPeerName = safeGet('cf_peerName', '');
        if (savedPeerName) {
            peerEls.nameInput.value = savedPeerName;
        }
        const savedPeerAvatar = safeGet('cf_peerAvatar', '');
        if (savedPeerAvatar) {
            peerEls.myAvatarImg.src = savedPeerAvatar;
        }
        const savedFriendId = safeGet('cf_friendId', '');
        if (savedFriendId) {
            peerEls.friendInput.value = savedFriendId;
        }

        peerEls.nameInput.addEventListener('input', (e) => {
            safeSet('cf_peerName', e.target.value);
            broadcastState();
        });

        peerEls.avatarUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    // Create an image to resize it (reduce WebRTC payload)
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_SIZE = 100;
                        let width = img.width;
                        let height = img.height;
                        if (width > height) {
                            if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                        } else {
                            if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
                        }
                        canvas.width = width; canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                        
                        peerEls.myAvatarImg.src = dataUrl;
                        safeSet('cf_peerAvatar', dataUrl);
                        broadcastState();
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            }
        });

        function generateShortId() {
            return 'doc-' + Math.random().toString(36).substr(2, 5);
        }

        function initPeer() {
            const savedId = safeGet('cf_myPeerId', null) || generateShortId();
            safeSet('cf_myPeerId', savedId);

            peer = new Peer(savedId, {
                debug: 1
            });

            peer.on('open', (id) => {
                peerEls.myIdInput.value = id;
                updatePeerUI('standby');

                const friendId = safeGet('cf_friendId', '');
                if (friendId) {
                    setTimeout(() => {
                        updatePeerUI('connecting');
                        const conn = peer.connect(friendId, { reliable: true });
                        conn.on('open', () => setupPeerConnection(conn));
                    }, 500); // slight delay to ensure peerjs backend is fully ready
                }
            });

            peer.on('connection', (conn) => {
                setupPeerConnection(conn);
            });
            
            peer.on('disconnected', () => {
                updatePeerUI('standby');
                peer.reconnect();
            });

            peer.on('error', (err) => {
                console.error('Peer error:', err);
                if (err.type === 'unavailable-id') {
                    try { localStorage.removeItem('cf_myPeerId'); } catch(e) {}
                    initPeer();
                } else if (err.type === 'peer-unavailable') {
                    console.log('Colega no encontrado para auto-reconexión.');
                    updatePeerUI('standby');
                }
            });
        }

        function setupPeerConnection(conn) {
            if (peerConnection) {
                peerConnection.close();
            }
            peerConnection = conn;
            
            updatePeerUI('connected');
            peerEls.remoteAvatarImg.classList.remove('opacity-50', 'grayscale');

            conn.on('data', (data) => {
                if (data.type === 'state_sync') {
                    renderRemoteState(data.payload);
                } else if (data.type === 'chat') {
                    appendChatMessage(data.sender || 'Amigo', data.text, false);
                } else if (data.type === 'fuerzas') {
                    showFuerzasToast(data.sender || 'Amigo', data.message);
                }
            });

            conn.on('close', () => {
                peerConnection = null;
                updatePeerUI('standby');
                peerEls.mode.textContent = 'De vacaciones 🌴';
                peerEls.mode.className = 'text-[9px] uppercase tracking-widest text-slate-500 font-bold';
                peerEls.remoteAvatarImg.classList.add('opacity-50', 'grayscale');
            });
        }

        function appendChatMessage(sender, text, isMe) {
            if (isChatMinimized && !isMe) {
                peerEls.fabBadge.classList.remove('hidden');
                try { const beep = new Audio('https://www.soundjay.com/buttons/sounds/beep-07a.mp3'); beep.play(); } catch(e) {}
            }
            const div = document.createElement('div');
            div.className = `flex ${isMe ? 'justify-end' : 'justify-start'} animate-fade-in`;
            const bgColor = isMe ? 'var(--chat-me)' : 'var(--chat-them)';
            const textColor = isMe ? '#ffffff' : '#e2e8f0';
            div.innerHTML = `<span class="px-3 py-2 rounded-2xl max-w-[85%] shadow-md break-words text-xs leading-relaxed" style="background-color: ${bgColor}; color: ${textColor};"><b>${sender}:</b> ${text}</span>`;
            peerEls.chatMessages.appendChild(div);
            peerEls.chatMessages.scrollTo({ top: peerEls.chatMessages.scrollHeight, behavior: 'smooth' });

            if(!isMe && !isChatOpen) {
                unreadChatCount++;
                updateChatBadge();
                playPagerSound();
            }
        }

        peerEls.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = peerEls.chatInput.value.trim();
            if(text && peerConnection) {
                const myName = peerEls.nameInput.value.trim() || 'Yo';
                peerConnection.send({ type: 'chat', text: text, sender: myName });
                appendChatMessage(myName, text, true);
                peerEls.chatInput.value = '';
            }
        });

        function updatePeerUI(status) {
            if (status === 'standby') {
                peerEls.statusTxt.textContent = "Standby";
                peerEls.led.className = "w-2.5 h-2.5 rounded-full bg-clinical-yellow shadow-[0_0_8px_rgba(234,179,8,0.6)] transition-all duration-300";
                peerEls.btnConnect.disabled = false;
                peerEls.friendInput.disabled = false;
                peerEls.chatContainer.classList.add('hidden');
                isChatOpen = false;
            } else if (status === 'connecting') {
                peerEls.statusTxt.textContent = "Conectando...";
                peerEls.led.className = "w-2.5 h-2.5 rounded-full bg-clinical-blue animate-pulse transition-all duration-300";
                peerEls.btnConnect.disabled = true;
                peerEls.friendInput.disabled = true;
            } else if (status === 'connected') {
                peerEls.statusTxt.textContent = "En línea";
                peerEls.led.className = "w-2.5 h-2.5 rounded-full bg-clinical-green shadow-[0_0_8px_rgba(16,185,129,0.6)] transition-all duration-300";
                peerEls.card.classList.remove('hidden');
                peerEls.card.classList.add('flex');
                peerEls.btnConnect.disabled = false;
                peerEls.friendInput.disabled = false;
                peerEls.chatContainer.classList.remove('hidden');
                peerEls.chatFab.classList.remove('hidden', 'scale-0');
            }
        }

        function broadcastState() {
            if (!peerConnection || !peerConnection.open) return;
            
            let activeSubName = 'Descanso';
            if (state.timer.mode === 'study') {
                const sub = state.subjects.find(s => s.id === state.timer.activeSubjectId);
                activeSubName = sub ? sub.name : 'Estudio';
            }

            const payload = {
                name: peerEls.nameInput.value || 'Colega',
                avatar: peerEls.myAvatarImg.src,
                mode: state.timer.mode, 
                timeLeft: state.timer.timeLeft,
                totalTime: state.config.times[state.timer.mode === 'short-break' ? 'shortBreak' : (state.timer.mode === 'long-break' ? 'longBreak' : 'study')] * 60,
                subject: activeSubName,
                hours: state.stats.hoursToday.toFixed(1),
                isRunning: state.timer.isRunning,
                
                // Patient Data
                patientActive: state.game.active,
                patientId: state.game.patientId,
                patientHealth: state.game.health,
                patientPhase: state.game.phase
            };

            peerConnection.send({ type: 'state_sync', payload });
        }

        function renderRemoteState(p) {
            peerEls.remoteName.textContent = p.name || 'Colega';
            if (p.avatar && p.avatar.startsWith('data:image')) {
                peerEls.remoteAvatarImg.src = p.avatar;
                peerEls.remoteAvatarImg.classList.remove('hidden');
                peerEls.remoteAvatarIcon.classList.add('hidden');
            } else {
                peerEls.remoteAvatarImg.classList.add('hidden');
                peerEls.remoteAvatarIcon.classList.remove('hidden');
            }

            peerEls.timer.textContent = formatTime(p.timeLeft);
            peerEls.subject.textContent = p.subject;
            peerEls.hours.textContent = p.hours;
            
            const total = Math.max(1, p.totalTime);
            const progPct = ((total - p.timeLeft) / total) * 100;
            peerEls.progressBar.style.width = `${progPct}%`;
            
            const isStudy = p.mode === 'study';
            let modeTxt = isStudy ? 'EN GUARDIA' : 'EN DESCANSO';
            if (!p.isRunning) modeTxt = 'PAUSADO';
            
            peerEls.timer.className = `text-xs font-mono font-bold ${!p.isRunning ? 'text-slate-500' : (isStudy ? 'text-white' : 'text-slate-400')}`;
            peerEls.subject.className = `text-[10px] px-2 py-0.5 rounded border ${isStudy ? 'bg-clinical-blue/20 text-clinical-blue border-clinical-blue/30' : 'bg-slate-700/50 text-slate-400 border-slate-600'}`;
            peerEls.progressBar.className = `h-full rounded-full transition-all duration-1000 ${isStudy ? 'bg-clinical-blue' : 'bg-slate-500'}`;
            peerEls.mode.textContent = modeTxt;
            peerEls.mode.className = `text-[9px] uppercase tracking-widest ${isStudy && p.isRunning ? 'text-clinical-blue animate-pulse' : 'text-slate-500'}`;

            // Patient rendering
            if (p.patientActive) {
                peerEls.remotePatientContainer.classList.remove('hidden');
                peerEls.remotePatientId.textContent = p.patientId;
                peerEls.remotePatientHpText.textContent = `${p.patientHealth}/100`;
                peerEls.remotePatientHpBar.style.width = `${p.patientHealth}%`;
                
                if (p.patientHealth > 50) {
                    peerEls.remotePatientHpBar.className = "bg-clinical-green h-1.5 rounded-full transition-all duration-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]";
                    peerEls.remotePatientHpText.className = "text-[9px] font-mono font-bold text-clinical-green";
                } else if (p.patientHealth > 20) {
                    peerEls.remotePatientHpBar.className = "bg-clinical-yellow h-1.5 rounded-full transition-all duration-500 shadow-[0_0_5px_rgba(234,179,8,0.5)]";
                    peerEls.remotePatientHpText.className = "text-[9px] font-mono font-bold text-clinical-yellow";
                } else {
                    peerEls.remotePatientHpBar.className = "bg-clinical-red h-1.5 rounded-full transition-all duration-500 shadow-[0_0_5px_rgba(244,63,94,0.5)] animate-pulse";
                    peerEls.remotePatientHpText.className = "text-[9px] font-mono font-bold text-clinical-red animate-pulse";
                }

                // Sprite
                const sprites = ['🤒', '🤕', '🤢', '😵', '😪'];
                peerEls.remotePatientSprite.textContent = sprites[p.patientPhase] || '🤒';
            } else {
                peerEls.remotePatientContainer.classList.add('hidden');
            }
        }

        peerEls.btnCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(peerEls.myIdInput.value).then(() => {
                const icon = peerEls.btnCopy.querySelector('i');
                icon.className = 'fa-solid fa-check text-clinical-green';
                setTimeout(() => icon.className = 'fa-regular fa-copy', 2000);
            });
        });

        peerEls.btnConnect.addEventListener('click', () => {
            const friendId = peerEls.friendInput.value.trim();
            if (!friendId) return;
            
            safeSet('cf_friendId', friendId);
            
            updatePeerUI('connecting');
            const conn = peer.connect(friendId, { reliable: true });
            
            conn.on('open', () => {
                setupPeerConnection(conn);
            });
        });
        
        // Broadcast heartbeat every second
        setInterval(() => {
            broadcastState();
        }, 1000);

        // Initialize PeerJS
        setTimeout(initPeer, 1000);

    

        // --- PRÓXIMA GUARDIA PASIVA (HOLIDAYS) ---
        function updateGuardiaWidget() {
            const currentYear = new Date().getFullYear();
            // Feriados fijos en formato MM-DD
            const fixedHolidays = [
                '01-01', '03-24', '04-02', '05-01', '05-25', '06-20', 
                '07-06', // Cba
                '07-09', 
                '09-30', // Cba
                '12-08', '12-25'
            ];
            
            let nextDate = null;
            let minDiff = Infinity;
            const now = new Date();
            now.setHours(0,0,0,0);
            
            // Evaluamos este año y el siguiente
            [currentYear, currentYear + 1].forEach(year => {
                fixedHolidays.forEach(h => {
                    const [m, d] = h.split('-');
                    const date = new Date(year, parseInt(m) - 1, parseInt(d));
                    const diff = date - now;
                    if (diff > 0 && diff < minDiff) {
                        minDiff = diff;
                        nextDate = date;
                    }
                });
            });
            
            const daysLeft = Math.ceil(minDiff / (1000 * 60 * 60 * 24));
            const elCountdown = document.getElementById('guardia-countdown');
            const elDate = document.getElementById('guardia-date');
            if(elCountdown && elDate && nextDate) {
                elCountdown.textContent = daysLeft + (daysLeft === 1 ? ' DÍA' : ' DÍAS');
                const options = { weekday: 'long', day: 'numeric', month: 'long' };
                elDate.textContent = nextDate.toLocaleDateString('es-AR', options).toUpperCase();
            }
        }
        updateGuardiaWidget();
        // Update every hour just in case
        setInterval(updateGuardiaWidget, 3600000);





