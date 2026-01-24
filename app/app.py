from flask import Flask, render_template, request, jsonify, send_file
import os
import sqlite3
import pandas as pd
from datetime import datetime
import hashlib
import shutil
import pytz
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Configuración
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# Crear directorios si no existen
for folder in ['data', 'uploads', 'templates', 'static']:
    os.makedirs(folder, exist_ok=True)

# ========== FUNCIONES DE BASE DE DATOS ==========

def init_database():
    """Inicializa la base de datos desde cero"""
    conn = sqlite3.connect('data/historical.db')
    cursor = conn.cursor()
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_id INTEGER,
        month INTEGER,
        date INTEGER,
        start_timestamp INTEGER,
        end_timestamp INTEGER,
        duration INTEGER,
        trip REAL,
        electricity REAL,
        fuel REAL,
        efficiency REAL,
        start_datetime TIMESTAMP,
        end_datetime TIMESTAMP,
        file_hash TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(start_timestamp, end_timestamp, trip, electricity)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS uploaded_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        file_hash TEXT UNIQUE,
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        trips_added INTEGER
    )
    ''')
    
    conn.commit()
    conn.close()
    print("✅ Base de datos inicializada")

def calculate_file_hash(filepath):
    """Calcula hash MD5 de un archivo"""
    with open(filepath, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()

def process_database_file(filepath, filename):
    """Procesa un archivo .db del BYD"""
    file_hash = calculate_file_hash(filepath)
    
    conn_byd = sqlite3.connect(filepath)
    
    try:
        tables = pd.read_sql_query("SELECT name FROM sqlite_master WHERE type='table'", conn_byd)
        
        table_name = None
        for table in tables['name']:
            if 'consumption' in table.lower() or 'energy' in table.lower():
                table_name = table
                break
        
        if not table_name:
            table_name = tables['name'][0]
        
        print(f"📊 Usando tabla: {table_name}")
        df = pd.read_sql_query(f"SELECT * FROM {table_name}", conn_byd)
        
    except Exception as e:
        print(f"❌ Error leyendo archivo: {e}")
        conn_byd.close()
        return {"status": "error", "message": f"Error leyendo archivo: {str(e)}"}
    
    if df.empty:
        conn_byd.close()
        return {"status": "error", "message": "No se encontraron datos en el archivo"}
    
    print(f"📊 Datos encontrados: {len(df)} registros")
    
    required_columns = ['trip', 'electricity', 'start_timestamp', 'end_timestamp']
    for col in required_columns:
        if col not in df.columns:
            print(f"❌ Columna faltante: {col}")
            conn_byd.close()
            return {"status": "error", "message": f"Columna '{col}' no encontrada en el archivo"}
    
    # Calcular eficiencia con umbral de 0.1 kWh
    df['efficiency'] = df.apply(
        lambda row: row['trip'] / row['electricity'] if row['electricity'] > 0.1 else 7.0,
        axis=1
    )
    
    # Ajustar timestamps si están en milisegundos
    if df['start_timestamp'].max() > 2000000000:
        df['start_timestamp'] = df['start_timestamp'] / 1000
        df['end_timestamp'] = df['end_timestamp'] / 1000
    
    # Convertir timestamps a datetime
    df['start_datetime'] = pd.to_datetime(df['start_timestamp'], unit='s')
    df['end_datetime'] = pd.to_datetime(df['end_timestamp'], unit='s')
    
    # Ajustar a hora de España
    spain_tz = pytz.timezone('Europe/Madrid')
    
    def adjust_to_spain_time(dt_series):
        adjusted_times = []
        for dt in dt_series:
            dt_utc = pytz.utc.localize(dt)
            dt_spain = dt_utc.astimezone(spain_tz)
            dt_spain_naive = dt_spain.replace(tzinfo=None)
            adjusted_times.append(dt_spain_naive)
        return pd.Series(adjusted_times, index=dt_series.index)
    
    df['start_datetime'] = adjust_to_spain_time(df['start_datetime'])
    df['end_datetime'] = adjust_to_spain_time(df['end_datetime'])
    
    conn_hist = sqlite3.connect('data/historical.db')
    cursor = conn_hist.cursor()
    
    cursor.execute("SELECT id FROM uploaded_files WHERE file_hash = ?", (file_hash,))
    file_exists = cursor.fetchone()
    
    trips_added = 0
    trips_skipped = 0
    
    for _, row in df.iterrows():
        try:
            month = row['start_datetime'].month
            day = row['start_datetime'].day
            
            cursor.execute('''
            INSERT OR IGNORE INTO trips 
            (original_id, month, date, start_timestamp, end_timestamp, 
             duration, trip, electricity, fuel, efficiency, 
             start_datetime, end_datetime, file_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                int(row.get('_id', 0)) if '_id' in df.columns else 0,
                month,
                day,
                int(row['start_timestamp']),
                int(row['end_timestamp']),
                int(row['duration']) if 'duration' in df.columns else int((row['end_timestamp'] - row['start_timestamp'])),
                float(row['trip']),
                float(row['electricity']),
                float(row['fuel']) if 'fuel' in df.columns else 0.0,
                float(row['efficiency']),
                row['start_datetime'].isoformat(),
                row['end_datetime'].isoformat(),
                file_hash
            ))
            
            if cursor.rowcount > 0:
                trips_added += 1
            else:
                trips_skipped += 1
                
        except Exception as e:
            print(f"⚠Error insertando viaje: {e}")
            trips_skipped += 1
            continue
    
    if not file_exists:
        cursor.execute('''
        INSERT INTO uploaded_files (filename, file_hash, trips_added)
        VALUES (?, ?, ?)
        ''', (filename, file_hash, trips_added))
        print(f"📝 Archivo nuevo registrado: {filename}")
    elif trips_added > 0:
        cursor.execute('''
        UPDATE uploaded_files 
        SET trips_added = trips_added + ?, upload_date = CURRENT_TIMESTAMP
        WHERE file_hash = ?
        ''', (trips_added, file_hash))
        print(f"📝Archivo actualizado: {filename} (+{trips_added} viajes)")
    
    conn_hist.commit()
    conn_byd.close()
    conn_hist.close()
    
    print(f"✅ Procesado: {trips_added} nuevos, {trips_skipped} duplicados")
    
    return {
        "status": "success" if trips_added > 0 else "skipped",
        "message": f"Archivo procesado: {trips_added} viajes nuevos añadidos" if trips_added > 0 else "No se aÑadieron viajes nuevos (todos ya existían)",
        "trips_added": trips_added,
        "trips_skipped": trips_skipped,
        "total_in_file": len(df),
        "file_was_new": not file_exists
    }

def get_all_trips(limit=None, order="DESC"):
    """Obtiene todos los viajes ordenados por timestamp UNIX"""
    conn = sqlite3.connect('data/historical.db')
    
    order_sql = "DESC" if order.upper() == "DESC" else "ASC"
    
    query = f'''
    SELECT 
        id,
        strftime('%m', start_datetime) as month_num,
        strftime('%d', start_datetime) as day_num,
        datetime(start_datetime) as start_time,
        datetime(end_datetime) as end_time,
        duration, 
        trip, 
        electricity, 
        fuel, 
        efficiency,
        ROUND(trip / (duration / 3600.0), 1) as avg_speed
    FROM trips 
    ORDER BY start_timestamp {order_sql}
    '''
    
    if limit:
        query += f' LIMIT {limit}'
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    return df

def get_consumption_stats():
    """Obtiene estadísticas de consumo detalladas"""
    conn = sqlite3.connect('data/historical.db')
    cursor = conn.cursor()
    
    cursor.execute('''
    SELECT 
        COUNT(*) as total_trips,
        COALESCE(SUM(trip), 0) as total_distance,
        COALESCE(SUM(electricity), 0) as total_consumption,
        COALESCE(AVG(efficiency), 0) as avg_efficiency,
        COALESCE(MIN(efficiency), 0) as min_efficiency,
        COALESCE(MAX(efficiency), 0) as max_efficiency,
        COALESCE(AVG(trip / (duration / 3600.0)), 0) as avg_speed
    FROM trips
    ''')
    
    stats_row = cursor.fetchone()
    
    cursor.execute('''
    SELECT 
        CASE 
            WHEN trip < 5 THEN 'Cortos (<5km)'
            WHEN trip BETWEEN 5 AND 20 THEN 'Medios (5-20km)'
            ELSE 'Largos (>20km)'
        END as distance_category,
        COUNT(*) as count,
        AVG(efficiency) as avg_efficiency,
        AVG(electricity) as avg_consumption
    FROM trips 
    WHERE trip > 0
    GROUP BY distance_category
    ORDER BY 
        CASE distance_category
            WHEN 'Cortos (<5km)' THEN 1
            WHEN 'Medios (5-20km)' THEN 2
            ELSE 3
        END
    ''')
    
    by_distance = cursor.fetchall()
    
    cursor.execute('''
    SELECT 
        strftime('%Y-%m', start_datetime) as month_str,
        COUNT(*) as trip_count,
        SUM(trip) as total_distance,
        SUM(electricity) as total_consumption,
        AVG(efficiency) as avg_efficiency
    FROM trips
    GROUP BY month_str
    ORDER BY month_str DESC
    LIMIT 12
    ''')
    
    monthly_data = cursor.fetchall()
    
    conn.close()
    
    return {
        "general": {
            "total_trips": stats_row[0] or 0,
            "total_distance": stats_row[1] or 0,
            "total_consumption": stats_row[2] or 0,
            "avg_efficiency": stats_row[3] or 0,
            "min_efficiency": stats_row[4] or 0,
            "max_efficiency": stats_row[5] or 0,
            "avg_speed": stats_row[6] or 0
        },
        "by_distance": [
            [row[0], row[1], row[2]] for row in by_distance
        ],
        "monthly": [
            {
                "month": row[0],
                "trip_count": row[1],
                "total_distance": row[2],
                "total_consumption": row[3],
                "avg_efficiency": row[4]
            } for row in monthly_data
        ]
    }

def get_energy_costs():
    """Calcula costes y emisiones comparativas"""
    conn = sqlite3.connect('data/historical.db')
    cursor = conn.cursor()
    
    # Obtener datos totales
    cursor.execute('''
    SELECT 
        COALESCE(SUM(trip), 0) as total_distance,
        COALESCE(SUM(electricity), 0) as total_consumption
    FROM trips
    ''')
    
    totals = cursor.fetchone()
    total_distance = totals[0] or 0
    total_consumption = totals[1] or 0
    
    conn.close()
    
    # Obtener variables de entorno con valores por defecto
    electricity_price = float(os.getenv('ELECTRICITY_PRICE', 0.15))
    gasoline_price = float(os.getenv('GASOLINE_PRICE', 1.50))
    diesel_price = float(os.getenv('DIESEL_PRICE', 1.40))
    gasoline_consumption = float(os.getenv('GASOLINE_CONSUMPTION', 7.0))
    diesel_consumption = float(os.getenv('DIESEL_CONSUMPTION', 5.5))
    co2_gasoline = float(os.getenv('CO2_GASOLINE', 120))
    co2_diesel = float(os.getenv('CO2_DIESEL', 95))
    
    # Cálculos
    # Coste eléctrico
    electric_cost = total_consumption * electricity_price
    
    # Coste gasolina
    gasoline_liters = total_distance * (gasoline_consumption / 100)
    gasoline_cost = gasoline_liters * gasoline_price
    
    # Coste diésel
    diesel_liters = total_distance * (diesel_consumption / 100)
    diesel_cost = diesel_liters * diesel_price
    
    # Emisiones (en kg, dividiendo entre 1000)
    electric_emissions = 0  # 0 porque depende del mix energético
    gasoline_emissions = (total_distance * co2_gasoline) / 1000
    diesel_emissions = (total_distance * co2_diesel) / 1000
    
    # Ahorros
    savings_vs_gasoline = gasoline_cost - electric_cost
    savings_vs_diesel = diesel_cost - electric_cost
    
    # Porcentajes de ahorro
    savings_pct_gasoline = (savings_vs_gasoline / gasoline_cost * 100) if gasoline_cost > 0 else 0
    savings_pct_diesel = (savings_vs_diesel / diesel_cost * 100) if diesel_cost > 0 else 0
    
    return {
        "totals": {
            "distance_km": round(total_distance, 1),
            "consumption_kwh": round(total_consumption, 1)
        },
        "prices": {
            "electricity": electricity_price,
            "gasoline": gasoline_price,
            "diesel": diesel_price
        },
        "consumptions": {
            "gasoline_l_100km": gasoline_consumption,
            "diesel_l_100km": diesel_consumption
        },
        "emissions_factors": {
            "gasoline_g_km": co2_gasoline,
            "diesel_g_km": co2_diesel
        },
        "costs": {
            "electric": round(electric_cost, 2),
            "gasoline": round(gasoline_cost, 2),
            "diesel": round(diesel_cost, 2)
        },
        "savings": {
            "vs_gasoline": {
                "amount": round(savings_vs_gasoline, 2),
                "percentage": round(savings_pct_gasoline, 1)
            },
            "vs_diesel": {
                "amount": round(savings_vs_diesel, 2),
                "percentage": round(savings_pct_diesel, 1)
            }
        },
        "emissions": {
            "gasoline_kg": round(gasoline_emissions, 1),
            "diesel_kg": round(diesel_emissions, 1),
            "electric_kg": electric_emissions
        }
    }

def get_db_status():
    """Obtiene el estado de la base de datos"""
    conn = sqlite3.connect('data/historical.db')
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM trips")
    total_trips = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(DISTINCT file_hash) FROM uploaded_files")
    unique_files = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM uploaded_files")
    total_files = cursor.fetchone()[0]
    
    cursor.execute("SELECT MAX(start_datetime) FROM trips")
    last_trip = cursor.fetchone()[0]
    
    cursor.execute("SELECT MIN(start_datetime) FROM trips")
    first_trip = cursor.fetchone()[0]
    
    conn.close()
    
    return {
        "total_trips": total_trips,
        "unique_files": unique_files,
        "total_files": total_files,
        "first_trip": first_trip or "N/A",
        "last_trip": last_trip or "N/A",
        "server_time": datetime.now().isoformat()
    }

# ========== RUTAS DE LA APLICACIóN ==========

@app.route('/')
def index():
    """Página principal"""
    return render_template('index.html')

@app.route('/api/trips')
def api_trips():
    """API: Obtener viajes"""
    try:
        limit = request.args.get('limit', 100)
        order = request.args.get('order', 'DESC')
        
        print(f"📊 API /api/trips llamada: limit={limit}, order={order}")
        
        trips_df = get_all_trips(
            limit=int(limit) if limit != '10000' else None,
            order=order
        )
        return jsonify(trips_df.to_dict(orient='records'))
    except Exception as e:
        print(f"❌ Error en /api/trips: {e}")
        return jsonify({"error": str(e), "trips": []}), 200

@app.route('/api/consumption')
def api_consumption():
    """API: Estadísticas de consumo detalladas"""
    try:
        stats = get_consumption_stats()
        return jsonify(stats)
    except Exception as e:
        print(f"❌ Error en /api/consumption: {e}")
        return jsonify({
            "general": {
                "total_trips": 0,
                "total_distance": 0,
                "total_consumption": 0,
                "avg_efficiency": 0,
                "min_efficiency": 0,
                "max_efficiency": 0,
                "avg_speed": 0
            },
            "by_distance": [],
            "monthly": []
        }), 200

@app.route('/api/energy_costs', methods=['GET', 'POST'])
def api_energy_costs():
    """API: Costes energéticos comparativos"""
    try:
        if request.method == 'POST':
            # Obtener parámetros personalizados del POST
            data = request.json or {}
            
            # Parámetros personalizados (si no vienen, usar valores por defecto del .env)
            electricity_price = float(data.get('electricity_price', os.getenv('ELECTRICITY_PRICE', 0.15)))
            gasoline_price = float(data.get('gasoline_price', os.getenv('GASOLINE_PRICE', 1.50)))
            diesel_price = float(data.get('diesel_price', os.getenv('DIESEL_PRICE', 1.40)))
            gasoline_consumption = float(data.get('gasoline_consumption', os.getenv('GASOLINE_CONSUMPTION', 7.0)))
            diesel_consumption = float(data.get('diesel_consumption', os.getenv('DIESEL_CONSUMPTION', 5.5)))
            co2_gasoline = float(data.get('co2_gasoline', os.getenv('CO2_GASOLINE', 120)))
            co2_diesel = float(data.get('co2_diesel', os.getenv('CO2_DIESEL', 95)))
            
            # Obtener datos totales
            conn = sqlite3.connect('data/historical.db')
            cursor = conn.cursor()
            
            # Construir query con filtro de fechas si se proporciona
            date_from = data.get('date_from')
            date_to = data.get('date_to')
            
            if date_from and date_to:
                # Filtrar por rango de fechas
                query = '''
                SELECT 
                    COALESCE(SUM(trip), 0) as total_distance,
                    COALESCE(SUM(electricity), 0) as total_consumption
                FROM trips
                WHERE date(start_datetime) BETWEEN ? AND ?
                '''
                cursor.execute(query, (date_from, date_to))
            else:
                # Todos los datos
                cursor.execute('''
                SELECT 
                    COALESCE(SUM(trip), 0) as total_distance,
                    COALESCE(SUM(electricity), 0) as total_consumption
                FROM trips
                ''')
            
            totals = cursor.fetchone()
            total_distance = totals[0] or 0
            total_consumption = totals[1] or 0
            
            conn.close()
            
            # Cálculos con parámetros personalizados
            electric_cost = total_consumption * electricity_price
            
            gasoline_liters = total_distance * (gasoline_consumption / 100)
            gasoline_cost = gasoline_liters * gasoline_price
            
            diesel_liters = total_distance * (diesel_consumption / 100)
            diesel_cost = diesel_liters * diesel_price
            
            # Emisiones (en kg)
            gasoline_emissions = (total_distance * co2_gasoline) / 1000
            diesel_emissions = (total_distance * co2_diesel) / 1000
            
            # Ahorros
            savings_vs_gasoline = gasoline_cost - electric_cost
            savings_vs_diesel = diesel_cost - electric_cost
            
            savings_pct_gasoline = (savings_vs_gasoline / gasoline_cost * 100) if gasoline_cost > 0 else 0
            savings_pct_diesel = (savings_vs_diesel / diesel_cost * 100) if diesel_cost > 0 else 0
            
            result = {
                "totals": {
                    "distance_km": round(total_distance, 1),
                    "consumption_kwh": round(total_consumption, 1)
                },
                "prices": {
                    "electricity": electricity_price,
                    "gasoline": gasoline_price,
                    "diesel": diesel_price
                },
                "consumptions": {
                    "gasoline_l_100km": gasoline_consumption,
                    "diesel_l_100km": diesel_consumption
                },
                "emissions_factors": {
                    "gasoline_g_km": co2_gasoline,
                    "diesel_g_km": co2_diesel
                },
                "costs": {
                    "electric": round(electric_cost, 2),
                    "gasoline": round(gasoline_cost, 2),
                    "diesel": round(diesel_cost, 2)
                },
                "savings": {
                    "vs_gasoline": {
                        "amount": round(savings_vs_gasoline, 2),
                        "percentage": round(savings_pct_gasoline, 1)
                    },
                    "vs_diesel": {
                        "amount": round(savings_vs_diesel, 2),
                        "percentage": round(savings_pct_diesel, 1)
                    }
                },
                "emissions": {
                    "gasoline_kg": round(gasoline_emissions, 1),
                    "diesel_kg": round(diesel_emissions, 1),
                    "electric_kg": 0
                },
                "custom_calculation": True
            }
            
            return jsonify(result)
        else:
            # GET: usar valores por defecto del .env
            result = get_energy_costs()
            result["custom_calculation"] = False
            return jsonify(result)
            
    except Exception as e:
        print(f"❌ Error en /api/energy_costs: {e}")
        return jsonify({
            "error": str(e),
            "costs": {
                "electric": 0,
                "gasoline": 0,
                "diesel": 0
            },
            "savings": {
                "vs_gasoline": {"amount": 0, "percentage": 0},
                "vs_diesel": {"amount": 0, "percentage": 0}
            },
            "emissions": {
                "gasoline_kg": 0,
                "diesel_kg": 0,
                "electric_kg": 0
            }
        }), 200

@app.route('/api/monthly')
def api_monthly():
    """API: Datos mensuales para gráficos"""
    try:
        conn = sqlite3.connect('data/historical.db')
        cursor = conn.cursor()
        
        cursor.execute('''
        SELECT 
            strftime('%Y-%m', start_datetime) as month_str,
            COUNT(*) as trip_count,
            SUM(trip) as total_distance,
            SUM(electricity) as total_consumption,
            AVG(efficiency) as avg_efficiency
        FROM trips
        GROUP BY month_str
        ORDER BY month_str DESC
        LIMIT 12
        ''')
        
        monthly_data = cursor.fetchall()
        conn.close()
        
        result = [
            {
                "month": row[0],
                "trip_count": row[1] or 0,
                "total_distance": row[2] or 0,
                "total_consumption": row[3] or 0,
                "avg_efficiency": row[4] or 0
            }
            for row in monthly_data
        ]
        
        return jsonify(result)
    except Exception as e:
        print(f"❌ Error en /api/monthly: {e}")
        return jsonify([]), 200

@app.route('/api/db_status')
def api_db_status():
    """API: Estado de la base de datos"""
    try:
        status = get_db_status()
        return jsonify(status)
    except Exception as e:
        print(f"❌ Error en /api/db_status: {e}")
        return jsonify({
            "total_trips": 0,
            "unique_files": 0,
            "total_files": 0,
            "first_trip": "N/A",
            "last_trip": "N/A",
            "server_time": datetime.now().isoformat()
        }), 200

@app.route('/api/upload', methods=['POST'])
def api_upload():
    """API: Subir archivo .db"""
    if 'file' not in request.files:
        return jsonify({"error": "No se encontró el archivo"}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({"error": "No se seleccionó ningún archivo"}), 400
    
    if not file.filename.endswith('.db'):
        return jsonify({"error": "Solo se permiten archivos .db"}), 400
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{timestamp}_{file.filename}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    try:
        file.save(filepath)
        print(f"📝¤ Archivo guardado temporalmente: {filepath}")
    except Exception as e:
        print(f"❌ Error guardando archivo: {e}")
        return jsonify({"error": f"Error guardando archivo: {str(e)}"}), 500
    
    try:
        print(f"🔄 Procesando archivo: {filename}")
        result = process_database_file(filepath, filename)
        
        backup_dir = os.path.join('data', 'uploaded_files')
        os.makedirs(backup_dir, exist_ok=True)
        
        if os.path.exists(filepath):
            if result.get('file_was_new', True):
                backup_path = os.path.join(backup_dir, filename)
                shutil.copy2(filepath, backup_path)
                print(f"📝 Archivo copiado a backup: {backup_path}")
            
            os.remove(filepath)
            print(f"🗑 Archivo temporal eliminado: {filepath}")
        
        print(f"✅ Resultado final: {result}")
        return jsonify(result)
        
    except Exception as e:
        print(f"❌ Error procesando archivo: {e}")
        if os.path.exists(filepath):
            os.remove(filepath)
            print(f"🗑 Archivo temporal eliminado por error: {filepath}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/health')
def api_health():
    """API: Estado del servicio"""
    return jsonify({
        "status": "healthy",
        "service": "BYD Analyzer",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0",
        "database": os.path.exists('data/historical.db'),
        "upload_folder": os.path.exists('subir_fichero'),
        "timezone": "Europe/Madrid (automático)"
    })

@app.route('/api/debug')
def api_debug():
    """API: Debug para verificar datos"""
    conn = sqlite3.connect('data/historical.db')
    
    query = '''
    SELECT 
        id,
        start_timestamp,
        start_datetime,
        strftime('%Y-%m-%d %H:%M:%S', start_datetime) as formatted,
        month,
        date,
        trip,
        electricity
    FROM trips 
    ORDER BY start_timestamp ASC 
    LIMIT 5
    '''
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    return jsonify({
        "first_5_trips": df.to_dict(orient='records'),
        "total_trips": len(df) if not df.empty else 0,
        "server_time": datetime.now().isoformat(),
        "server_time_spain": datetime.now(pytz.timezone('Europe/Madrid')).isoformat()
    })


# ========== FUNCIONES DE BACKUP ==========

def create_backup():
    """Crea un archivo de backup con todos los datos"""
    try:
        import zipfile
        import json
        
        # Crear nombre con timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_filename = f"BYD_Backup_{timestamp}.backup"
        backup_path = os.path.join('data', backup_filename)
        
        # Obtener información de la BD actual
        conn = sqlite3.connect('data/historical.db')
        cursor = conn.cursor()
        
        # Contar viajes y archivos
        cursor.execute("SELECT COUNT(*) FROM trips")
        total_trips = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM uploaded_files")
        total_files = cursor.fetchone()[0]
        
        cursor.execute("SELECT MIN(start_datetime), MAX(start_datetime) FROM trips")
        date_range = cursor.fetchone()
        first_trip = date_range[0] if date_range[0] else "N/A"
        last_trip = date_range[1] if date_range[1] else "N/A"
        
        # Obtener lista de archivos subidos
        cursor.execute("SELECT filename, file_hash, upload_date, trips_added FROM uploaded_files")
        files_data = cursor.fetchall()
        
        # Crear manifest con metadatos
        manifest = {
            "version": "1.0",
            "created_at": datetime.now().isoformat(),
            "app_version": "3.1",
            "total_trips": total_trips,
            "total_files": total_files,
            "first_trip": first_trip,
            "last_trip": last_trip,
            "backup_type": "full"
        }
        
        # Crear archivo ZIP con todo
        with zipfile.ZipFile(backup_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Añadir base de datos
            zipf.write('data/historical.db', 'historical.db')
            
            # Añadir manifest como JSON
            manifest_str = json.dumps(manifest, indent=2)
            zipf.writestr('manifest.json', manifest_str)
            
            # Añadir lista de archivos subidos
            files_list = [
                {
                    "filename": row[0],
                    "hash": row[1],
                    "upload_date": row[2],
                    "trips_added": row[3]
                }
                for row in files_data
            ]
            files_str = json.dumps(files_list, indent=2)
            zipf.writestr('files_list.json', files_str)
        
        # Cerrar conexión SOLO AHORA
        conn.close()
        
        print(f"✅ Backup creado: {backup_filename}")
        print(f"   - Viajes: {total_trips}")
        print(f"   - Archivos: {total_files}")
        print(f"   - Rango: {first_trip} a {last_trip}")
        
        return backup_path, backup_filename, manifest
        
    except Exception as e:
        print(f"❌ Error creando backup: {e}")
        import traceback
        traceback.print_exc()
        raise

def restore_backup(backup_filepath):
    """Restaura datos desde un archivo de backup"""
    try:
        import zipfile
        import json
        import shutil
        
        print(f"🔄 Restaurando backup: {backup_filepath}")
        
        # Extraer backup a directorio temporal
        import tempfile
        extract_dir = tempfile.mkdtemp(prefix="byd_restore_")
        
        with zipfile.ZipFile(backup_filepath, 'r') as zipf:
            zipf.extractall(extract_dir)
        
        # Leer manifest
        manifest_path = os.path.join(extract_dir, 'manifest.json')
        if not os.path.exists(manifest_path):
            raise ValueError("Archivo de backup inválido: falta manifest.json")
        
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
        
        print(f"📝‹ Backup encontrado:")
        print(f"   - Versión: {manifest.get('version')}")
        print(f"   - Creado: {manifest.get('created_at')}")
        print(f"   - Viajes: {manifest.get('total_trips', 0)}")
        print(f"   - Archivos: {manifest.get('total_files', 0)}")
        
        # Hacer backup de la BD actual (por si acaso)
        current_backup = f"data/historical.db.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        if os.path.exists('data/historical.db'):
            shutil.copy2('data/historical.db', current_backup)
            print(f"💾 Backup actual guardado en: {current_backup}")
        
        # Reemplazar base de datos
        backup_db = os.path.join(extract_dir, 'historical.db')
        if os.path.exists(backup_db):
            shutil.copy2(backup_db, 'data/historical.db')
            print("✅ Base de datos restaurada")
        else:
            raise ValueError("Archivo de backup inválido: falta historical.db")
        
        # Limpiar temporal
        shutil.rmtree(extract_dir)
        
        return manifest
        
    except Exception as e:
        print(f"❌ Error restaurando backup: {e}")
        import traceback
        traceback.print_exc()
        
        # Limpiar temporal si existe
        if 'extract_dir' in locals() and os.path.exists(extract_dir):
            shutil.rmtree(extract_dir, ignore_errors=True)
        
        raise

def get_backup_info(backup_filepath):
    """Obtiene información de un archivo de backup sin restaurarlo"""
    try:
        import zipfile
        import json
        import tempfile
        
        print(f"🔍 Analizando backup: {backup_filepath}")
        
        # Extraer solo el manifest
        with zipfile.ZipFile(backup_filepath, 'r') as zipf:
            # Buscar manifest
            if 'manifest.json' not in zipf.namelist():
                raise ValueError("Archivo de backup inválido")
            
            # Leer manifest
            with zipf.open('manifest.json') as f:
                manifest_data = f.read().decode('utf-8')
                manifest = json.loads(manifest_data)
        
        return manifest
        
    except Exception as e:
        print(f"❌ Error analizando backup: {e}")
        raise

# ========== RUTAS DE BACKUP ==========

@app.route('/api/backup/export', methods=['GET'])
def api_backup_export():
    """API: Exportar backup de todos los datos"""
    try:
        backup_path, backup_filename, manifest = create_backup()
        
        # Devolver el archivo para descarga
        return send_file(
            backup_path,
            as_attachment=True,
            download_name=backup_filename,
            mimetype='application/zip'
        )
        
    except Exception as e:
        print(f"❌ Error en /api/backup/export: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/backup/import', methods=['POST'])
def api_backup_import():
    """API: Importar backup"""
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No se encontró el archivo"}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({"error": "No se seleccionó ningún archivo"}), 400
        
        if not file.filename.endswith('.backup'):
            return jsonify({"error": "Solo se permiten archivos .backup"}), 400
        
        # Guardar temporalmente en /tmp/
        import tempfile
        temp_path = os.path.join(tempfile.gettempdir(), f"byd_backup_{file.filename}")
        file.save(temp_path)
        
        # Verificar que es un backup válido
        manifest = get_backup_info(temp_path)
        
        # Restaurar backup
        restore_manifest = restore_backup(temp_path)
        
        # Limpiar archivo temporal
        os.remove(temp_path)
        
        return jsonify({
            "status": "success",
            "message": "Backup restaurado correctamente",
            "backup_info": restore_manifest,
            "restored_at": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"❌ Error en /api/backup/import: {e}")
        # Limpiar si hay error
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({"error": str(e)}), 500

@app.route('/api/backup/info', methods=['POST'])
def api_backup_info():
    """API: Obtener información de un backup sin restaurarlo"""
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No se encontró el archivo"}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({"error": "No se seleccionó ningún archivo"}), 400
        
        # Guardar temporalmente en /tmp/
        import tempfile
        temp_path = os.path.join(tempfile.gettempdir(), f"byd_backup_{file.filename}")
        file.save(temp_path)
        
        # Obtener información
        manifest = get_backup_info(temp_path)
        
        # Limpiar archivo temporal
        os.remove(temp_path)
        
        return jsonify({
            "status": "success",
            "backup_info": manifest
        })
        
    except Exception as e:
        print(f"❌ Error en /api/backup/info: {e}")
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({"error": str(e)}), 500

@app.route('/api/system/status', methods=['GET'])
def api_system_status():
    """API: Estado del sistema y datos"""
    try:
        conn = sqlite3.connect('data/historical.db')
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM trips")
        total_trips = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM uploaded_files")
        total_files = cursor.fetchone()[0]
        
        cursor.execute("SELECT MIN(start_datetime), MAX(start_datetime) FROM trips")
        date_range = cursor.fetchone()
        
        cursor.execute("SELECT SUM(trip), SUM(electricity) FROM trips")
        totals = cursor.fetchone()
        
        conn.close()
        
        # Tamaño de la BD
        db_size = 0
        if os.path.exists('data/historical.db'):
            db_size = os.path.getsize('data/historical.db')
        
        return jsonify({
            "database": {
                "total_trips": total_trips,
                "total_files": total_files,
                "first_trip": date_range[0] if date_range[0] else "N/A",
                "last_trip": date_range[1] if date_range[1] else "N/A",
                "total_distance": round(totals[0], 2) if totals[0] else 0,
                "total_consumption": round(totals[1], 2) if totals[1] else 0,
                "size_bytes": db_size,
                "size_mb": round(db_size / (1024 * 1024), 2)
            },
            "system": {
                "version": "3.1",
                "backup_supported": True,
                "server_time": datetime.now().isoformat(),
                "timezone": "Europe/Madrid"
            }
        })
        
    except Exception as e:
        print(f"❌ Error en /api/system/status: {e}")
        return jsonify({"error": str(e)}), 500

# ========== INICIALIZACIóN ==========

if __name__ == '__main__':
    print("=" * 50)
    print("🚀 Iniciando BYD Analyzer v1.1...")
    print("=" * 50)
    
    init_database()
    
    print("✅ Base de datos inicializada")
    print("📊 Directorios verificados:")
    print(f"   - data/: {os.path.exists('data')}")
    print(f"   - uploads/: {os.path.exists('uploads')}")
    print(f"   - templates/: {os.path.exists('templates')}")
    print(f" Zona horaria configurada: Europe/Madrid (UTC+1/UTC+2 automático)")
    
    print("\n Endpoints disponibles:")
    print("   GET  /              → Interfaz web")
    print("   GET  /api/trips     → Lista de viajes")
    print("   GET  /api/consumption → Estadísticas")
    print("   GET  /api/monthly   → Datos mensuales")
    print("   GET  /api/db_status → Estado BD")
    print("   POST /api/upload    → Subir archivos")
    print("   GET  /api/health    → Estado servicio")
    print("   GET  /api/debug     → Debug")
    
    print("\n" + "=" * 50)
    print("✅ Servidor listo en http://0.0.0.0:5000")
    print("=" * 50)
    
    app.run(host='0.0.0.0', port=5000, debug=False)
    

    
