#!/usr/bin/env bash
# =====================================================
# VITALE — monta a pasta www/ para o Capacitor
# =====================================================
# O site é HTML puro servido pelo Cloudflare Pages. O Capacitor precisa de
# uma pasta única com os arquivos que vão DENTRO do app. Este script copia
# o necessário e deixa de fora o que só existe na web.
#
# Uso:  bash scripts/build-app.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ limpando www/"
rm -rf www
mkdir -p www

echo "→ copiando arquivos do app"
cp app.html www/index.html          # dentro do app, a tela inicial é o app
cp -r assets www/
cp -r icons www/
cp manifest.json www/
cp config.js www/ 2>/dev/null || echo "  aviso: config.js não encontrado — o app não vai conectar no Supabase"
cp privacidade.html termos.html www/ 2>/dev/null || true

# O service worker é da web. Dentro do app ele só cria uma camada de cache
# a mais para dar problema — o próprio WebView já cuida disso.
echo "→ removendo registro do service worker da versão empacotada"
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('www/index.html')
s = p.read_text(encoding='utf-8')
s = re.sub(r"<script>\s*if \('serviceWorker' in navigator\)[\s\S]*?</script>", '', s)
p.write_text(s, encoding='utf-8')
print('  service worker removido de www/index.html')
PY

# Estas telas são acessadas pelo navegador, não pelo app do paciente.
echo "→ portal do médico e Torre ficam FORA do app (são de navegador)"

echo "→ pronto. Agora:  npx cap sync"
ls -la www/
