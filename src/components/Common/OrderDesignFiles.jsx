import { useEffect, useState } from 'react';
import { orderApi, guestOrderToken, orderRequest } from '../../utils/orderApi';
import './OrderDesignFiles.css';

export function OrderDesignFiles({ order, user }) {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const headers = () => {
    try { const token = guestOrderToken(order.id); return token ? { 'X-Order-Token': token } : {}; } catch { return {}; }
  };
  useEffect(() => {
    let active = true;
    setFiles([]); setError(''); setLoading(true);
    const finish = () => { if (active) setLoading(false); };
    orderApi(`/api/orders/${encodeURIComponent(order.id)}/files`, { headers: headers() }, user)
      .then(data => { if (active) { setFiles(Array.isArray(data.files) ? data.files : []); setError(''); } })
      .catch(e => { if (active) setError(e.message); })
      .finally(finish);
    return () => { active = false; };
  }, [order.id, user, retry]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  const open = async (file, download = false) => {
    setBusy(true); setError('');
    try {
      const response = await orderRequest(`/api/orders/${encodeURIComponent(order.id)}/files/${file.id}`, { headers: headers() }, user);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (!download && ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) setPreview({ url, name: file.name });
      else {
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = file.name; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="bm-design-files">
    <h3>Uploaded Design</h3>
    {loading && <p className="bm-design-files__state" role="status">Loading attachment…</p>}
    {error && <div className="bm-design-files__error" role="alert"><span>{error}</span><button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
    {!loading && !files.length && !error && <p className="bm-design-files__state">No attached file recorded.</p>}
    {files.map(file => <div className="bm-design-file" key={file.id}><span className="bm-design-file__name" title={file.name}><span className="bm-design-file__icon"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m8 15 2-2 2 2 2-3 2 3"/></svg></span><span className="bm-design-file__filename">{file.name}</span></span><div className="bm-design-file__actions"><button type="button" disabled={busy} onClick={() => open(file)}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>Preview</button><button type="button" disabled={busy} onClick={() => open(file, true)}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m-4-4 4 4 4-4M5 20h14"/></svg>Download</button></div></div>)}
    {preview && <div className="bm-design-preview"><img src={preview.url} alt={`Preview of ${preview.name}`} /><button type="button" onClick={() => setPreview(null)}>Close preview</button></div>}
  </section>;
}
