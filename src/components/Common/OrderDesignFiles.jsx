import { useEffect, useState } from 'react';
import { orderApi, guestOrderToken, orderRequest } from '../../utils/orderApi';

export function OrderDesignFiles({ order, user }) {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [retry, setRetry] = useState(0);
  const headers = () => {
    try { const token = guestOrderToken(order.id); return token ? { 'X-Order-Token': token } : {}; } catch { return {}; }
  };
  useEffect(() => {
    let active = true;
    setFiles([]); setError('');
    orderApi(`/api/orders/${encodeURIComponent(order.id)}/files`, { headers: headers() }, user)
      .then(data => { if (active) setFiles(data.files); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [order.id, user, retry]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  const open = async file => {
    setBusy(true); setError('');
    try {
      const response = await orderRequest(`/api/orders/${encodeURIComponent(order.id)}/files/${file.id}`, { headers: headers() }, user);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) setPreview({ url, name: file.name });
      else {
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = file.name; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section style={{ margin: '16px 0' }}>
    <strong>Uploaded design / reference</strong>
    {error && <p role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {!files.length && !error && <p>No attached file recorded.</p>}
    {files.map(file => <div key={file.id} style={{ marginTop: 8, overflowWrap: 'anywhere' }}><button disabled={busy} onClick={() => open(file)}>View / download {file.name}</button></div>)}
    {preview && <div><img src={preview.url} alt={preview.name} style={{ display: 'block', maxWidth: '100%', maxHeight: 400, objectFit: 'contain', marginTop: 12 }} /><button onClick={() => setPreview(null)}>Close preview</button></div>}
  </section>;
}
