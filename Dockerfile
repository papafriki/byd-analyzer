# Dockerfile
FROM python:3.9-slim

WORKDIR /app

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    sqlite3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar la aplicación
COPY app/ /app/

# Crear SOLO los directorios necesarios
RUN mkdir -p /app/data /app/uploads \
    && chmod -R 755 /app/data /app/uploads

# Crear usuario no-root
RUN useradd -m -u 1000 byduser \
    && chown -R byduser:byduser /app

USER byduser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:5000/api/health || exit 1

CMD ["python", "app.py"]