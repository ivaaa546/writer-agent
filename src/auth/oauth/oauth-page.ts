/**
 * HTML pages returned by the local OAuth callback server.
 */

export function oauthSuccessHtml(message: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Writer Agent — Autenticación exitosa</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f;
      color: #e8e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #13131a;
      border: 1px solid #2a2a3a;
      border-radius: 16px;
      padding: 48px;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .icon { font-size: 52px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 12px; color: #a78bfa; }
    p { font-size: 15px; color: #8888a0; line-height: 1.6; }
    .badge {
      display: inline-block;
      margin-top: 24px;
      padding: 6px 16px;
      background: #1a1a2e;
      border: 1px solid #3a3a5a;
      border-radius: 100px;
      font-size: 13px;
      color: #6b6b88;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>¡Autenticación completada!</h1>
    <p>${message}</p>
    <span class="badge">Puedes cerrar esta ventana</span>
  </div>
</body>
</html>`;
}

export function oauthErrorHtml(message: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Writer Agent — Error de autenticación</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f;
      color: #e8e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #13131a;
      border: 1px solid #3a1a1a;
      border-radius: 16px;
      padding: 48px;
      max-width: 420px;
      text-align: center;
    }
    .icon { font-size: 52px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 12px; color: #f87171; }
    p { font-size: 15px; color: #8888a0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Error de autenticación</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
