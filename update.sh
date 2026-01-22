#!/bin/bash
# update.sh - Script de actualización para BYD Analyzer
# Diseñado para el proyecto: https://github.com/papafriki/byd-analyzer

set -e  # Detener el script si hay un error

echo ""
echo "⚡ BYD Analyzer - Actualizador Automático"
echo "=========================================="
echo ""

# 1. Verificar que estamos en el directorio correcto
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ ERROR: No se encuentra 'docker-compose.yml'."
    echo "   Asegúrate de ejecutar este script desde el directorio principal"
    echo "   del proyecto (donde está docker-compose.yml)."
    exit 1
fi

# 2. Backup automático de la base de datos (muy recomendable)
if [ -f "data/historical.db" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="data/historical.db.backup_${TIMESTAMP}"
    echo "📦 Creando copia de seguridad de la base de datos..."
    cp "data/historical.db" "${BACKUP_FILE}"
    echo "   ✅ Backup creado: $(basename ${BACKUP_FILE})"
else
    echo "ℹ️  No se encontró base de datos existente. Se creará una nueva."
fi

# 3. Obtener la última versión del código
echo ""
echo "⬇️  Descargando actualizaciones desde GitHub..."
if [ -d ".git" ]; then
    git fetch origin
    git pull origin main
    echo "   ✅ Código actualizado."
else
    echo "❌ ERROR: No es un repositorio Git."
    echo "   Para actualizar manualmente:"
    echo "   1. Visita https://github.com/papafriki/byd-analyzer"
    echo "   2. Descarga el código nuevo"
    echo "   3. Sobrescribe los archivos (excepto 'data/', 'uploads/' y '.env')"
    exit 1
fi

# 4. Reconstruir la aplicación con Docker
echo ""
echo "🐳 Reconstruyendo la aplicación Docker..."
docker-compose build --no-cache
echo "   ✅ Imagen Docker reconstruida."

# 5. Reiniciar los contenedores
echo ""
echo "♻️  Reiniciando los contenedores..."
docker-compose down
docker-compose up -d
echo "   ✅ Contenedores reiniciados y en ejecución."

# 6. Verificación final
echo ""
echo "🔍 Verificando que todo funcione..."
sleep 3  # Esperar un momento a que la app arranque
if curl -s http://localhost:5005/api/health > /dev/null; then
    echo "   ✅ La aplicación responde correctamente."
else
    echo "   ⚠️  La aplicación no responde inmediatamente. Puede tardar unos segundos más."
    echo "   Usa 'docker-compose logs -f' para ver el estado."
fi

# 7. Mostrar información útil
echo ""
echo "=========================================="
echo "🎉 ¡Actualización completada!"
echo ""
echo "📊 Accede a la aplicación en:"
echo "   http://localhost:5005"
echo ""
echo "📝 Comandos útiles:"
echo "   • Ver logs:              docker-compose logs -f"
echo "   • Ver estado:            docker-compose ps"
echo "   • Parar la app:          docker-compose down"
echo "   • Forzar reconstrucción: docker-compose build --no-cache"
echo ""