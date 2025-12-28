// Variables globales
let dataTable = null;
let isUploading = false;
let allStats = null;

// Inicializar al cargar
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    checkDatabaseStatus();
});

function initializeApp() {
	console.log('🚀 initializeApp() iniciando...'); // DEBUG
    loadDashboardStats();
    loadTripsTable();
    setupUpload();
    // INICIALIZAR SISTEMA DE BACKUP (NUEVO)
	console.log('🔧 Llamando a initializeBackupSystem()...'); 
    initializeBackupSystem();
    console.log('✅ initializeBackupSystem() llamado'); // DEBUG
    // Actualizar cada 30 segundos
    setInterval(loadDashboardStats, 30000);
	console.log('🏁 initializeApp() completado'); // DEBUG
}

function setupEventListeners() {
    // Navegación suave para navbar sticky
    document.querySelectorAll('a.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                updateActiveNavLink(targetId);
            }
        });
    });
    
    // Actualizar enlace activo al hacer scroll
    window.addEventListener('scroll', updateActiveNavOnScroll);
}

function updateActiveNavLink(sectionId) {
    document.querySelectorAll('a.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${sectionId}`) {
            link.classList.add('active');
        }
    });
}

function updateActiveNavOnScroll() {
    const sections = ['dashboard', 'trips', 'consumption', 'upload'];
    const scrollPosition = window.scrollY + 100;
    
    for (const sectionId of sections) {
        const section = document.getElementById(sectionId);
        if (section) {
            const sectionTop = section.offsetTop - 70;
            const sectionBottom = sectionTop + section.offsetHeight;
            
            if (scrollPosition >= sectionTop && scrollPosition < sectionBottom) {
                updateActiveNavLink(sectionId);
                break;
            }
        }
    }
}

// ===== DASHBOARD =====
async function loadDashboardStats() {
    try {
        // Mostrar spinners mientras carga
        const statIds = ['statTrips', 'statDistance', 'statConsumption', 'statEfficiency'];
        statIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        });
        
        const response = await fetch('/api/consumption');
        allStats = await response.json();
        
        const general = allStats.general;
        document.getElementById('statTrips').textContent = general.total_trips || 0;
        document.getElementById('statDistance').textContent = general.total_distance ? general.total_distance.toFixed(0) : 0;
        document.getElementById('statConsumption').textContent = general.total_consumption ? general.total_consumption.toFixed(0) : 0;
        document.getElementById('statEfficiency').textContent = general.avg_efficiency ? general.avg_efficiency.toFixed(1) : '0.0';
        
        loadMonthlyChart();
        loadDistanceChart();
        loadEfficiencyChart();
        loadHourlyChart();
        loadDetailedStats();
        
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}

// ===== VIAJES =====
async function loadTripsTable() {
    try {
        const response = await fetch('/api/trips?limit=10000&order=DESC');
        const trips = await response.json();
        
        const tbody = document.getElementById('tripsBody');
        tbody.innerHTML = '';
        
        // Actualizar contador
        document.getElementById('tripsCount').textContent = `${trips.length} viajes`;
        document.getElementById('totalCount').textContent = trips.length;
        
        if (trips.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-4">
                        <i class="bi bi-info-circle me-2"></i>
                        No hay viajes registrados. Sube un archivo .db para comenzar.
                    </td>
                </tr>
            `;
            
            if (dataTable) {
                dataTable.destroy();
                dataTable = null;
            }
            
            updatePageInfo();
            return;
        }
        
        // Crear filas CON data-order para ordenación correcta
        trips.forEach(trip => {
            const startDate = new Date(trip.start_time);
            const endDate = new Date(trip.end_time);
            
            // Formato para ordenación: YYYYMMDD (para que ordene cronológicamente)
            const year = startDate.getFullYear();
            const month = String(startDate.getMonth() + 1).padStart(2, '0');
            const day = String(startDate.getDate()).padStart(2, '0');
            const orderDate = year + month + day;
            
            const efficiencyClass = getEfficiencyClass(trip.efficiency);
            const efficiencyBadge = trip.efficiency && trip.efficiency > 0 ? 
                `<span class="badge ${efficiencyClass}">${trip.efficiency.toFixed(2)} km/kWh</span>` :
                '<span class="badge bg-secondary">N/A</span>';
            
            const row = document.createElement('tr');
            row.className = 'trip-row';
            row.innerHTML = `
                <td data-order="${orderDate}">${formatDate(startDate)}</td>
                <td>${formatTime(startDate)}</td>
                <td>${formatTime(endDate)}</td>
                <td><strong>${trip.trip.toFixed(1)}</strong> km</td>
                <td><strong>${trip.electricity.toFixed(1)}</strong> kWh</td>
                <td>${efficiencyBadge}</td>
                <td>${trip.avg_speed ? trip.avg_speed.toFixed(0) + ' km/h' : 'N/A'}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="showTripDetails(${trip.id})">
                        <i class="bi bi-info-circle"></i>
                    </button>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        // Destruir DataTable anterior si existe
        if (dataTable) {
            dataTable.destroy();
        }
        
        // Inicializar DataTable
        dataTable = $('#tripsTable').DataTable({
            pageLength: 25,
            lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "Todos"]],
            order: [[0, 'desc']],
            language: {
                url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/es-ES.json'
            },
            dom: 'Bfrtip',
            buttons: [
                {
                    extend: 'copy',
                    text: '<i class="bi bi-clipboard"></i> Copiar',
                    className: 'btn btn-sm'
                },
                {
                    extend: 'csv',
                    text: '<i class="bi bi-file-earmark-spreadsheet"></i> CSV',
                    className: 'btn btn-sm',
                    title: 'byd_viajes_' + new Date().toISOString().split('T')[0]
                },
                {
                    extend: 'print',
                    text: '<i class="bi bi-printer"></i> Imprimir',
                    className: 'btn btn-sm'
                }
            ],
            initComplete: function() {
                updatePageInfo();
            },
            drawCallback: function() {
                updatePageInfo();
            }
        });
        
        updatePageInfo();
        
    } catch (error) {
        console.error('Error cargando viajes:', error);
        showToast('Error cargando viajes', 'error');
    }
}

function changePageSize(size) {
    if (dataTable) {
        if (size === -1) {
            dataTable.page.len(-1).draw();
        } else {
            dataTable.page.len(size).draw();
        }
        updatePageInfo();
        showToast(`Mostrando ${size === -1 ? 'todos' : size} registros por página`, 'info');
    }
}

function updatePageInfo() {
    if (dataTable) {
        const info = dataTable.page.info();
        const start = info.start + 1;
        const end = info.end;
        const total = info.recordsDisplay;
        const filtered = info.recordsDisplay !== info.recordsTotal;
        
        document.getElementById('currentRange').textContent = 
            total === 0 ? '0-0' : `${start}-${end}`;
        document.getElementById('totalCount').textContent = total;
        
        let filterText = '';
        if (filtered) {
            filterText = `(filtrado de ${info.recordsTotal} total)`;
        }
        document.getElementById('filterInfo').textContent = filterText;
    }
}

async function showTripDetails(tripId) {
    try {
        const response = await fetch(`/api/trips?limit=10000`);
        const trips = await response.json();
        const trip = trips.find(t => t.id === tripId);
        
        if (!trip) {
            document.getElementById('tripDetails').innerHTML = '<p class="text-danger">Viaje no encontrado</p>';
            return;
        }
        
        const startDate = new Date(trip.start_time);
        const endDate = new Date(trip.end_time);
        const durationHours = (trip.duration / 3600).toFixed(1);
        const cost = (trip.electricity * 0.15).toFixed(2);
        
        const detailsHtml = `
            <div class="row">
                <div class="col-md-6">
                    <h6><i class="bi bi-calendar"></i> Información del Viaje</h6>
                    <table class="table table-sm">
                        <tr><td><strong>Fecha:</strong></td><td>${formatDate(startDate)}</td></tr>
                        <tr><td><strong>Hora inicio:</strong></td><td>${formatTime(startDate)}</td></tr>
                        <tr><td><strong>Hora fin:</strong></td><td>${formatTime(endDate)}</td></tr>
                        <tr><td><strong>Duración:</strong></td><td>${durationHours} horas</td></tr>
                    </table>
                </div>
                <div class="col-md-6">
                    <h6><i class="bi bi-graph-up"></i> Métricas</h6>
                    <table class="table table-sm">
                        <tr><td><strong>Distancia:</strong></td><td>${trip.trip.toFixed(1)} km</td></tr>
                        <tr><td><strong>Consumo:</strong></td><td>${trip.electricity.toFixed(1)} kWh</td></tr>
                        <tr><td><strong>Eficiencia:</strong></td><td>${trip.efficiency ? trip.efficiency.toFixed(2) + ' km/kWh' : 'N/A'}</td></tr>
                        <tr><td><strong>Vel. media:</strong></td><td>${trip.avg_speed ? trip.avg_speed.toFixed(0) + ' km/h' : 'N/A'}</td></tr>
                        <tr><td><strong>Coste estimado:</strong></td><td>${cost} €</td></tr>
                    </table>
                </div>
            </div>
            <div class="row mt-3">
                <div class="col-12">
                    <h6><i class="bi bi-calculator"></i> Cálculos Detallados</h6>
                    <div class="alert alert-info">
                        <strong>Consumo por 100km:</strong> ${(trip.electricity / trip.trip * 100).toFixed(1)} kWh/100km<br>
                        <strong>Eficiencia:</strong> ${trip.efficiency ? trip.efficiency.toFixed(2) : 'N/A'} km/kWh<br>
                        <strong>Coste por km:</strong> ${trip.trip > 0 ? (cost / trip.trip).toFixed(3) : '0.000'} €/km
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('tripDetails').innerHTML = detailsHtml;
        
        const modal = new bootstrap.Modal(document.getElementById('tripModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error cargando detalles:', error);
        showToast('Error cargando detalles del viaje', 'error');
    }
}

// ===== CONSUMO =====
async function loadMonthlyChart() {
    try {
        const response = await fetch('/api/monthly');
        const monthlyData = await response.json();
        
        if (monthlyData.length === 0) {
            document.getElementById('monthlyChart').innerHTML = '<p class="text-center text-muted py-5">No hay datos mensuales disponibles</p>';
            return;
        }
        
        const months = monthlyData.map(m => m.month).reverse();
        const consumption = monthlyData.map(m => m.total_consumption).reverse();
        const distance = monthlyData.map(m => m.total_distance).reverse();
        
        const trace1 = {
            x: months,
            y: consumption,
            name: 'Consumo (kWh)',
            type: 'bar',
            marker: { color: 'rgba(58, 71, 80, 0.6)' }
        };
        
        const trace2 = {
            x: months,
            y: distance,
            name: 'Distancia (km)',
            type: 'scatter',
            mode: 'lines+markers',
            yaxis: 'y2',
            line: { color: 'rgba(220, 53, 69, 0.8)' }
        };
        
        const layout = {
            title: 'Consumo y Distancia Mensual',
            yaxis: { title: 'Consumo (kWh)' },
            yaxis2: {
                title: 'Distancia (km)',
                overlaying: 'y',
                side: 'right'
            },
            showlegend: true,
            legend: { x: 0, y: 1.2 }
        };
        
        Plotly.newPlot('monthlyChart', [trace1, trace2], layout);
    } catch (error) {
        console.error('Error cargando gráfico mensual:', error);
    }
}

async function loadDistanceChart() {
    try {
        if (!allStats || !allStats.by_distance || allStats.by_distance.length === 0) {
            document.getElementById('distanceChart').innerHTML = '<p class="text-center text-muted py-5">No hay datos por distancia</p>';
            return;
        }
        
        // ORDENAR: Cortos, Medios, Largos
        const distanceData = [...allStats.by_distance];
        
        const orderMap = {
            'Cortos (<5km)': 1,
            'Medios (5-20km)': 2, 
            'Largos (>20km)': 3
        };
        
        // Ordenar según el orden deseado
        distanceData.sort((a, b) => {
            const orderA = orderMap[a[0]] || 4;
            const orderB = orderMap[b[0]] || 4;
            return orderA - orderB;
        });
        
        // Extraer datos ya ordenados
        const categories = distanceData.map(d => d[0]);
        const counts = distanceData.map(d => d[1]);
        
        const data = [{
            values: counts,
            labels: categories,
            type: 'pie',
            hole: .4,
            marker: {
                colors: ['#1e3c72', '#2a5298', '#5a9fff']
            }
        }];
        
        const layout = {
            title: 'Distribución por Distancia',
            showlegend: true
        };
        
        Plotly.newPlot('distanceChart', data, layout);
    } catch (error) {
        console.error('Error cargando gráfico de distancia:', error);
    }
}

async function loadEfficiencyChart() {
    try {
        if (!allStats || !allStats.by_distance || allStats.by_distance.length === 0) {
            document.getElementById('efficiencyChart').innerHTML = '<p class="text-center text-muted py-5">No hay datos de eficiencia</p>';
            return;
        }
        
        // ORDENAR igual que en loadDistanceChart
        const efficiencyData = [...allStats.by_distance];
        const orderMap = {
            'Cortos (<5km)': 1,
            'Medios (5-20km)': 2, 
            'Largos (>20km)': 3
        };
        
        efficiencyData.sort((a, b) => {
            const orderA = orderMap[a[0]] || 4;
            const orderB = orderMap[b[0]] || 4;
            return orderA - orderB;
        });
        
        const categories = efficiencyData.map(d => d[0]);
        const efficiencies = efficiencyData.map(d => d[2] || 0);
        
        const data = [{
            x: categories,
            y: efficiencies,
            type: 'bar',
            marker: {
                color: ['#1e3c72', '#2a5298', '#5a9fff']
            }
        }];
        
        const layout = {
            title: 'Eficiencia por Tipo de Viaje',
            yaxis: { 
                title: 'km/kWh',
                range: [0, Math.max(...efficiencies) * 1.2]
            }
        };
        
        Plotly.newPlot('efficiencyChart', data, layout);
    } catch (error) {
        console.error('Error cargando gráfico de eficiencia:', error);
    }
}

async function loadHourlyChart() {
    try {
        const response = await fetch('/api/trips?limit=10000');
        const trips = await response.json();
        
        if (trips.length === 0) {
            document.getElementById('hourlyChart').innerHTML = '<p class="text-center text-muted py-5">No hay datos suficientes</p>';
            return;
        }
        
        const hourlyData = Array(24).fill(0);
        trips.forEach(trip => {
            if (trip.start_time) {
                const hour = new Date(trip.start_time).getHours();
                hourlyData[hour] += trip.electricity;
            }
        });
        
        const hasData = hourlyData.some(val => val > 0);
        if (!hasData) {
            document.getElementById('hourlyChart').innerHTML = '<p class="text-center text-muted py-5">No hay datos por hora</p>';
            return;
        }
        
        const hours = Array.from({length: 24}, (_, i) => `${i}:00`);
        
        const data = [{
            x: hours,
            y: hourlyData,
            type: 'scatter',
            mode: 'lines+markers',
            line: { 
                color: '#1e3c72',
                width: 3 
            },
            marker: { 
                color: '#2a5298',
                size: 8 
            },
            fill: 'tozeroy',
            fillcolor: 'rgba(30, 60, 114, 0.15)'
        }];
        
        const layout = {
            title: {
                text: 'Consumo por Hora del Día',
                font: {
                    color: '#1e3c72',
                    size: 16
                }
            },
            yaxis: { 
                title: 'kWh',
                titlefont: { color: '#1e3c72' },
                gridcolor: 'rgba(0,0,0,0.1)',
                zerolinecolor: 'rgba(0,0,0,0.2)'
            },
            xaxis: { 
                title: 'Hora',
                titlefont: { color: '#1e3c72' },
                gridcolor: 'rgba(0,0,0,0.1)'
            },
            plot_bgcolor: 'rgba(240, 242, 245, 0.5)',
            paper_bgcolor: 'rgba(255, 255, 255, 0.8)',
            hovermode: 'closest'
        };
        
        Plotly.newPlot('hourlyChart', data, layout);
    } catch (error) {
        console.error('Error cargando gráfico horario:', error);
        document.getElementById('hourlyChart').innerHTML = '<p class="text-center text-muted py-5">Error cargando datos</p>';
    }
}

function loadDetailedStats() {
    if (!allStats || !allStats.general) return;
    
    const general = allStats.general;
    const statsHtml = `
        <div class="col-md-3">
            <div class="card">
                <div class="card-body text-center">
                    <h6><i class="bi bi-speedometer"></i> Velocidad Media</h6>
                    <h3>${general.avg_speed ? general.avg_speed.toFixed(0) : '0'}</h3>
                    <p class="text-muted">km/h</p>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card">
                <div class="card-body text-center">
                    <h6><i class="bi bi-arrow-up"></i> Mejor Eficiencia</h6>
                    <h3 class="text-success">${general.max_efficiency ? general.max_efficiency.toFixed(2) : '0.00'}</h3>
                    <p class="text-muted">km/kWh</p>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card">
                <div class="card-body text-center">
                    <h6><i class="bi bi-arrow-down"></i> Peor Eficiencia</h6>
                    <h3 class="text-danger">${general.min_efficiency ? general.min_efficiency.toFixed(2) : '0.00'}</h3>
                    <p class="text-muted">km/kWh</p>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card">
                <div class="card-body text-center">
                    <h6><i class="bi bi-calculator"></i> Coste Estimado</h6>
                    <h3>${((general.total_consumption || 0) * 0.15).toFixed(1)}</h3>
                    <p class="text-muted">€ (0.15€/kWh)</p>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('detailedStats').innerHTML = statsHtml;
}

// ===== SUBIDA DE ARCHIVOS =====
// ===== SUBIDA DE ARCHIVOS =====
function setupUpload() {
    console.log('🔧 setupUpload() - Iniciando configuración de upload .db');
    
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');
    
    // VERIFICACIÓN CRÍTICA: Evitar que esta función interfiera con el área de backup
    if (dropArea && (dropArea.id === 'backupUploadArea' || dropArea.classList.contains('backup-upload-area'))) {
        console.log('⚠️ Se detectó área de backup, omitiendo configuración en setupUpload()');
        return; // Este es el área de backup, no lo manejamos aquí
    }
    
    if (!dropArea || !fileInput) {
        console.error('❌ No se pudo encontrar el área de upload o el input');
        return;
    }
    
    // Click en el área de drop
    dropArea.addEventListener('click', function(e) {
        console.log('🖱️ Click en área de upload .db');
        if (!isUploading) {
            fileInput.click();
        }
    });
    
    // Cuando se selecciona un archivo
    fileInput.addEventListener('change', function(e) {
        console.log('📄 Archivo .db seleccionado:', this.files[0]?.name);
        if (this.files && this.files[0]) {
            handleFiles(this.files);
        }
    });
    
    // Prevenir comportamientos por defecto en drag
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Efectos visuales al drag
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => {
            if (!isUploading) {
                dropArea.classList.add('dragover');
            }
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => {
            dropArea.classList.remove('dragover');
        }, false);
    });
    
    // Manejar drop
    dropArea.addEventListener('drop', handleDrop, false);
    
    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        console.log('📂 Drop de archivos:', files.length);
        if (files && files.length > 0) {
            handleFiles(files);
        }
    }
    
    console.log('✅ setupUpload() configurado correctamente para archivos .db');
}
function handleFiles(files) {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    if (!file.name.endsWith('.db')) {
        showUploadResult('<div class="alert alert-danger">Solo se permiten archivos .db</div>', 'error');
        document.getElementById('fileInput').value = '';
        return;
    }
    
    uploadFile(file);
}

async function uploadFile(file) {
    if (isUploading) {
        showUploadResult('<div class="alert alert-warning">Ya hay una subida en progreso</div>', 'warning');
        document.getElementById('fileInput').value = '';
        return;
    }
    
    isUploading = true;
    
    const formData = new FormData();
    formData.append('file', file);
    
    const progressBar = document.getElementById('uploadProgress');
    const resultDiv = document.getElementById('uploadResult');
    
    progressBar.classList.remove('d-none');
    progressBar.querySelector('.progress-bar').style.width = '0%';
    resultDiv.innerHTML = '<div class="alert alert-info">Procesando archivo...</div>';
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            showUploadResult(
                `<div class="alert alert-success">
                    <h5><i class="bi bi-check-circle"></i> ¡Archivo procesado!</h5>
                    <p>${result.message}</p>
                    <p><strong>Viajes añadidos:</strong> ${result.trips_added}</p>
                    <p><strong>Duplicados ignorados:</strong> ${result.trips_skipped || 0}</p>
                    <p><strong>Total en archivo:</strong> ${result.total_in_file}</p>
                    <p class="mt-2"><i class="bi bi-arrow-clockwise"></i> Actualizando datos...</p>
                </div>`,
                'success'
            );
            
            progressBar.querySelector('.progress-bar').style.width = '100%';
            
            setTimeout(() => {
                progressBar.classList.add('d-none');
                
                resultDiv.innerHTML = `
                    <div class="alert alert-info">
                        <h5><i class="bi bi-arrow-clockwise"></i> Actualizando datos...</h5>
                        <p>Recuperando nueva información...</p>
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">Cargando...</span>
                        </div>
                    </div>
                `;
                
                reloadAllData();
                
                setTimeout(() => {
                    showUploadResult(
                        `<div class="alert alert-success">
                            <h5><i class="bi bi-check-circle"></i> ¡Completado!</h5>
                            <p>${result.trips_added} nuevos viajes añadidos correctamente.</p>
                            <p>Los datos se han actualizado automáticamente.</p>
                        </div>`,
                        'success'
                    );
                    
                    document.getElementById('trips').scrollIntoView({
                        behavior: 'smooth'
                    });
                    
                    showToast(`${result.trips_added} nuevos viajes añadidos`, 'success');
                }, 1500);
                
            }, 800);
            
        } else if (result.status === 'skipped') {
            showUploadResult(
                `<div class="alert alert-info">
                    <h5><i class="bi bi-info-circle"></i> Archivo ya procesado</h5>
                    <p>${result.message}</p>
                </div>`,
                'info'
            );
            progressBar.classList.add('d-none');
        } else {
            showUploadResult(
                `<div class="alert alert-danger">
                    <h5><i class="bi bi-exclamation-triangle"></i> Error</h5>
                    <p>${result.message || result.error}</p>
                </div>`,
                'error'
            );
            progressBar.classList.add('d-none');
        }
        
    } catch (error) {
        showUploadResult(
            `<div class="alert alert-danger">
                <h5><i class="bi bi-exclamation-triangle"></i> Error de conexión</h5>
                <p>${error.message}</p>
            </div>`,
            'error'
        );
        progressBar.classList.add('d-none');
    } finally {
        document.getElementById('fileInput').value = '';
        isUploading = false;
    }
}

async function reloadAllData() {
    try {
        console.log("🔄 Recargando todos los datos...");
        
        // 1. Mostrar indicador de carga en estadísticas
        const statCards = document.querySelectorAll('.stat-value');
        statCards.forEach(card => {
            card.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        });
        
        // 2. Recargar estadísticas del dashboard
        await loadDashboardStats();
        console.log("✅ Dashboard actualizado");
        
        // 3. Recargar tabla de viajes
        await loadTripsTable();
        console.log("✅ Tabla de viajes actualizada");
        
        // 4. Actualizar estado de la BD
        setTimeout(async () => {
            await checkDatabaseStatus();
            console.log("✅ Estado de BD actualizado");
        }, 800);
        
    } catch (error) {
        console.error("❌ Error recargando datos:", error);
        showToast("Error recargando datos", "error");
    }
}
function showUploadResult(message, type) {
    const resultDiv = document.getElementById('uploadResult');
    resultDiv.innerHTML = message;
}

async function checkDatabaseStatus() {
    try {
        const response = await fetch('/api/db_status');
        const status = await response.json();
        
        document.getElementById('dbTripCount').textContent = status.total_trips;
        document.getElementById('dbFileCount').textContent = status.unique_files;
        
    } catch (error) {
        console.error('Error verificando estado:', error);
    }
}

// ===== FUNCIONES UTILITARIAS =====
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function getEfficiencyClass(efficiency) {
    if (!efficiency) return 'bg-secondary';
    if (efficiency > 6) return 'efficiency-excellent';
    if (efficiency > 5) return 'efficiency-good';
    if (efficiency > 0) return 'efficiency-poor';
    return 'bg-secondary';
}

function showToast(message, type = 'info') {
    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: type,
        title: message,
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true
    });
}


// ===== SISTEMA DE BACKUP =====

let currentBackupFile = null;
let backupFileInfo = null;

// Actualizar información del sistema
async function updateSystemInfo() {
    try {
        const response = await fetch('/api/system/status');
        const status = await response.json();
        
        if (status.database) {
            document.getElementById('currentTripCount').textContent = status.database.total_trips;
            document.getElementById('currentFileCount').textContent = status.database.total_files;
            document.getElementById('currentDbSize').textContent = status.database.size_mb + ' MB';
        }
        
    } catch (error) {
        console.error('Error actualizando información del sistema:', error);
    }
}

// Exportar backup
async function exportBackup() {
    try {
        const exportBtn = document.getElementById('exportBtn');
        const originalText = exportBtn.innerHTML;
        
        // Mostrar loading
        exportBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generando backup...';
        exportBtn.disabled = true;
        
        // Llamar a la API de exportación
        const response = await fetch('/api/backup/export');
        
        if (!response.ok) {
            throw new Error('Error en la exportación');
        }
        
        // Crear blob y descargar
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Obtener nombre del archivo del header o generar uno
        const contentDisposition = response.headers.get('content-disposition');
        let filename = 'BYD_Backup.backup';
        
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?(.+)"?/);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1];
            }
        }
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        // Mostrar mensaje de éxito
        showToast('Backup exportado correctamente', 'success');
        
        // Actualizar información
        setTimeout(updateSystemInfo, 1000);
        
    } catch (error) {
        console.error('Error exportando backup:', error);
        showToast('Error exportando backup: ' + error.message, 'error');
    } finally {
        // Restaurar botón
        const exportBtn = document.getElementById('exportBtn');
        exportBtn.innerHTML = '<i class="bi bi-download"></i> Exportar Backup';
        exportBtn.disabled = false;
    }
}

// Manejar selección de archivo de backup
function setupBackupUpload() {
    const backupFileInput = document.getElementById('backupFileInput');
    const backupUploadArea = document.getElementById('backupUploadArea');
    
    if (!backupFileInput || !backupUploadArea) {
        console.error('Error: Elementos de backup no encontrados');
        return;
    }
    
    // Click en área de backup
    backupUploadArea.addEventListener('click', function(e) {
        // Ignorar clicks directamente en el input para evitar doble disparo
        if (e.target.id === 'backupFileInput' || e.target.tagName === 'INPUT') {
            return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        backupFileInput.click();
    });
    
    // Listener para cuando se selecciona archivo
    backupFileInput.addEventListener('change', async function(e) {
        if (this.files && this.files.length > 0) {
            const file = this.files[0];
            
            if (file.name.endsWith('.backup')) {
                await handleBackupFile(file);
            } else {
                showToast('Solo se permiten archivos .backup', 'error');
            }
            
            this.value = '';
        }
    });
    
    // Drag & Drop - Prevenir defaults
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        backupUploadArea.addEventListener(eventName, function(e) {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });
    
    // Efectos visuales drag
    ['dragenter', 'dragover'].forEach(eventName => {
        backupUploadArea.addEventListener(eventName, () => {
            backupUploadArea.classList.add('dragover');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        backupUploadArea.addEventListener(eventName, () => {
            backupUploadArea.classList.remove('dragover');
        }, false);
    });
    
    // Manejar drop
    backupUploadArea.addEventListener('drop', async function(e) {
        const files = e.dataTransfer.files;
        
        if (files && files.length > 0) {
            const file = files[0];
            
            if (file.name.endsWith('.backup')) {
                await handleBackupFile(file);
            } else {
                showToast('Solo se permiten archivos .backup', 'error');
            }
        }
    }, false);
}

// Procesar archivo de backup seleccionado
async function handleBackupFile(file) {
    try {
        // Validar extensión
        if (!file.name.endsWith('.backup')) {
            showToast('Solo se permiten archivos .backup', 'error');
            return;
        }
        
        // Mostrar loading
        const backupPreview = document.getElementById('backupPreview');
        backupPreview.innerHTML = `
            <div class="text-center py-3">
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Analizando...</span>
                </div>
                <span class="ms-2">Analizando backup...</span>
            </div>
        `;
        backupPreview.classList.remove('d-none');
        
        // Crear FormData
        const formData = new FormData();
        formData.append('file', file);
        
        // Obtener información del backup
        const response = await fetch('/api/backup/info', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            currentBackupFile = file;
            backupFileInfo = result.backup_info;
            
            // Mostrar información
            backupPreview.innerHTML = `
                <div class="alert alert-info">
                    <h6><i class="bi bi-file-earmark-check"></i> Información del Backup</h6>
                    <div class="small">
                        <div><strong>Archivo:</strong> ${file.name}</div>
                        <div><strong>Tamaño:</strong> ${(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                        <div><strong>Viajes:</strong> <span id="backupTripCount">${result.backup_info.total_trips || 0}</span></div>
                        <div><strong>Archivos:</strong> <span id="backupFileCount">${result.backup_info.total_files || 0}</span></div>
                        <div><strong>Creado:</strong> <span id="backupCreatedAt">${formatBackupDate(result.backup_info.created_at)}</span></div>
                        <div><strong>Versión:</strong> <span id="backupVersion">${result.backup_info.version || '1.0'}</span></div>
                        ${result.backup_info.first_trip && result.backup_info.first_trip !== 'N/A' ? 
                            `<div><strong>Primer viaje:</strong> ${formatBackupDate(result.backup_info.first_trip)}</div>` : ''}
                        ${result.backup_info.last_trip && result.backup_info.last_trip !== 'N/A' ? 
                            `<div><strong>Último viaje:</strong> ${formatBackupDate(result.backup_info.last_trip)}</div>` : ''}
                    </div>
                </div>
            `;
            
            // Mostrar botón de importar
            document.getElementById('importBtn').classList.remove('d-none');
            
            showToast('Backup válido detectado', 'success');
            
        } else {
            throw new Error(result.error || 'Error analizando backup');
        }
        
    } catch (error) {
        console.error('Error procesando backup:', error);
        document.getElementById('backupPreview').innerHTML = `
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle"></i> Error: ${error.message}
            </div>
        `;
        showToast('Error analizando backup', 'error');
        currentBackupFile = null;
        backupFileInfo = null;
        document.getElementById('importBtn').classList.add('d-none');
    }
}

// Importar backup
async function importBackup() {
    try {
        if (!currentBackupFile) {
            showToast('No hay archivo de backup seleccionado', 'error');
            return;
        }
        
        // Confirmación de usuario (IMPORTANTE: reemplazará datos)
        const result = await Swal.fire({
            title: '¿Estás seguro?',
            html: `
                <div class="text-start">
                    <p><strong>¡Esta acción reemplazará TODOS los datos actuales!</strong></p>
                    <div class="alert alert-warning small">
                        <i class="bi bi-exclamation-triangle"></i>
                        <strong>Atención:</strong> Todos los viajes y datos actuales serán reemplazados por los del backup.
                    </div>
                    <div class="small">
                        <div><strong>Backup a restaurar:</strong> ${currentBackupFile.name}</div>
                        <div><strong>Viajes en backup:</strong> ${backupFileInfo.total_trips || 0}</div>
                        <div><strong>Fecha creación:</strong> ${formatBackupDate(backupFileInfo.created_at)}</div>
                    </div>
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Sí, restaurar',
            cancelButtonText: 'Cancelar'
        });
        
        if (!result.isConfirmed) {
            return;
        }
        
        // Mostrar loading
        const importBtn = document.getElementById('importBtn');
        const originalText = importBtn.innerHTML;
        importBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Restaurando...';
        importBtn.disabled = true;
        
        // Subir archivo para restaurar
        const formData = new FormData();
        formData.append('file', currentBackupFile);
        
        const response = await fetch('/api/backup/import', {
            method: 'POST',
            body: formData
        });
        
        const resultData = await response.json();
        
        if (response.ok) {
            // Éxito
            showToast('Backup restaurado correctamente', 'success');
            
            // Limpiar vista
            document.getElementById('backupPreview').classList.add('d-none');
            document.getElementById('importBtn').classList.add('d-none');
            document.getElementById('backupFileInput').value = '';
            currentBackupFile = null;
            backupFileInfo = null;
            
            // Recargar TODOS los datos
            setTimeout(async () => {
                await reloadAllData();
                await updateSystemInfo();
                await checkDatabaseStatus();
                
                // Mostrar resumen
                Swal.fire({
                    title: '¡Restauración completada!',
                    html: `
                        <div class="text-start">
                            <div class="alert alert-success">
                                <i class="bi bi-check-circle"></i> Backup restaurado correctamente
                            </div>
                            <div class="small">
                                <div><strong>Viajes restaurados:</strong> ${resultData.backup_info?.total_trips || 0}</div>
                                <div><strong>Archivos restaurados:</strong> ${resultData.backup_info?.total_files || 0}</div>
                                <div><strong>Fecha del backup:</strong> ${formatBackupDate(resultData.backup_info?.created_at)}</div>
                            </div>
                        </div>
                    `,
                    icon: 'success'
                });
            }, 1000);
            
        } else {
            throw new Error(resultData.error || 'Error restaurando backup');
        }
        
    } catch (error) {
        console.error('Error importando backup:', error);
        showToast('Error restaurando backup: ' + error.message, 'error');
        
        // Restaurar botón
        const importBtn = document.getElementById('importBtn');
        importBtn.innerHTML = originalText;
        importBtn.disabled = false;
    }
}

// Función auxiliar para formatear fecha de backup
function formatBackupDate(dateString) {
    try {
        if (!dateString || dateString === 'N/A') return 'N/A';
        
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
}

// Inicializar sistema de backup

function initializeBackupSystem() {
    console.log('💾 initializeBackupSystem() iniciando...'); // DEBUG
    
    // Configurar upload de backup
    console.log('   Configurando upload de backup...'); // DEBUG
    setupBackupUpload();
    
    // Actualizar información del sistema
    console.log('   Actualizando info del sistema...'); // DEBUG
    updateSystemInfo();
    
    // Actualizar cada 2 minutos
    setInterval(updateSystemInfo, 120000);
    
    console.log('✅ initializeBackupSystem() completado'); // DEBUG
}
