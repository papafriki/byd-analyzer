# ⚡ BYD Energy Analyzer v3.1

[![Docker](https://img.shields.io/badge/Docker-✓-blue)](https://www.docker.com/)
[![Python](https://img.shields.io/badge/Python-3.9+-green)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

Analizador de consumo energético para BYD ATTO con sistema completo de backup/restauración. Procesa datos del vehículo localmente, garantizando privacidad total.

## ✨ Características

- 📊 **Dashboard completo** con estadísticas en tiempo real
- 🗺️ **Historial de viajes** con filtros avanzados
- 📈 **Gráficos interactivos** de consumo y eficiencia
- 💾 **Sistema de backup** automático (exportar/importar)
- 🔒 **Procesamiento local** - sin enviar datos a la nube
- 📱 **Interfaz responsive** - funciona en móvil y desktop
- 🐳 **Despliegue con Docker** - fácil instalación

## 🚀 Instalación rápida

### Requisitos previos
- Docker y Docker Compose instalados
- 500MB de espacio libre
- Puerto 5005 disponible

### Pasos de instalación

1. **Clonar el repositorio:**
```bash
git clone https://github.com/papafriki/byd-analyzer.git
cd byd-analyzer
```
2. **Crear archivo de configuración:**
```bash
cp .env.example .env
# Edita .env si necesitas cambiar puerto o zona horaria
```
3. **Crear los directorios data y uploads con tu usuario para evitar problemas con los permisos:**
```bash
mkdir -p data uploads
chown -R $(id -u):$(id -g) data uploads
chmod 755 data uploads
```
4. **Construir e iniciar con Docker:**
```bash
docker-compose up -d
```
5. **Acceder a la aplicación:**
Abre tu navegador en: http://localhost:5005


### Estructura del proyecto
```bash
byd-analyzer/
├── app/                    # Código Flask
│   ├── static/            # CSS, JS, fuentes
│   ├── templates/         # HTML templates
│   └── app.py            # Aplicación principal
├── docker-compose.yml    # Configuración Docker
├── Dockerfile           # Definición imagen Docker
├── requirements.txt     # Dependencias Python
├── .env.example        # Configuración de ejemplo
├── .gitignore         # Archivos ignorados por Git
└── README.md          # Esta documentación
```

## 🖥️ Uso básico

### 1. Subir datos del BYD
- Conecta un USB a tu BYD ATTO
- Navega a la carpeta `energydata`
- Copia el archivo `EC_database.db` al USB
- En la aplicación, ve a "Subir Datos" y selecciona el archivo

### 2. Navegar por la aplicación
- **Dashboard:** Estadísticas principales y gráficos
- **Viajes:** Historial completo con filtros
- **Consumo:** Análisis detallado de eficiencia
- **Subir Datos:** Cargar nuevos archivos .db

### 3. Sistema de Backup
- **Exportar:** Ve a "Sistema de Copia de Seguridad" → "Exportar Backup"
- **Importar:** Sube un archivo `.backup` para restaurar datos
- ⚠️ **Importante:** La restauración reemplaza todos los datos actuales

## ⚙️ Configuración

Edita el archivo `.env` para personalizar:

```env
# Puerto de acceso web
PORT=5005

# Zona horaria (cambia según tu ubicación)
TZ=Europe/Madrid

# Precios opcionales para cálculos
# ELECTRICITY_PRICE=0.15
# GASOLINE_PRICE=1.50
```

**Zonas horarias disponibles:**
- Europe/Madrid (España)
- America/Mexico_City (México)
-America/New_York (EST)
-Europe/London (UK)

Ver más: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones


## 🔧 Comandos útiles

```bash
# Iniciar la aplicación
docker-compose up -d

# Detener la aplicación
docker-compose down

# Ver logs en tiempo real
docker-compose logs -f

# Ver estado del servicio
curl http://localhost:5005/api/health

# Reconstruir después de cambios
docker-compose build
docker-compose up -d
```

## 🐛 Solución de problemas

### Error: "Puerto ya en uso"
```bash
# Cambia el puerto en .env
nano .env  # Cambia PORT=5005 a PORT=8080
docker-compose up -d
```
### Error: "No se pueden subir archivos .db"

- Verifica que el archivo sea del BYD ATTO
- Comprueba que tenga extensión .db
- Asegúrate de que no esté corrupto

### Error: "Docker no está instalado"
```bash
# Instalar Docker en Debian/Ubuntu/Raspberry Pi OS
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Reinicia la sesión o ejecuta: newgrp docker

# Instalar Docker Compose
sudo apt install docker-compose -y
```
### La aplicación no muestra datos
- Verifica que hayas subido un archivo `.db` válido
- Revisa los logs: `docker-compose logs -f`
- Asegúrate de que el archivo contenga datos de viajes

## 📊 API endpoints disponibles

- `GET /` - Interfaz web principal
- `GET /api/health` - Estado del servicio
- `GET /api/trips` - Lista de viajes
- `GET /api/consumption` - Estadísticas
- `GET /api/monthly` - Datos mensuales
- `POST /api/upload` - Subir archivo .db
- `GET /api/backup/export` - Exportar backup
- `POST /api/backup/import` - Importar backup

## 🤝 Contribuir

1. Haz fork del repositorio
2. Crea una rama: `git checkout -b mi-mejora`
3. Haz commit: `git commit -m 'Añadir característica'`
4. Push: `git push origin mi-mejora`
5. Abre Pull Request

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver [LICENSE](LICENSE) para más detalles.

## 👨‍💻 Autor

Desarrollado por Alberto (papafriki) - Para la comunidad BYD

## 🙏 Agradecimientos

- Comunidad BYD España
- Desarrolladores de Flask, Docker, Plotly
- Todos los testers y colaboradores



