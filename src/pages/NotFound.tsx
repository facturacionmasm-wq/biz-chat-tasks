import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';

export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { console.error('[RYBIX] 404 — ruta no encontrada:', location.pathname); }, [location.pathname]);

  return (
    <div style={{ minHeight:'100vh', background:'var(--rx-bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:24, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', inset:0, pointerEvents:'none', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', fontFamily:'var(--rx-font-display)', fontSize:'clamp(180px,35vw,420px)', fontWeight:900, letterSpacing:'-0.08em', color:'transparent', WebkitTextStroke:'1px rgba(0,255,198,0.05)', userSelect:'none', lineHeight:1, whiteSpace:'nowrap' }}>404</div>
        <div style={{ position:'absolute', width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle, rgba(0,255,198,.07), transparent)', filter:'blur(80px)', top:'20%', left:'10%' }} />
      </div>
      <div style={{ position:'relative', zIndex:1, textAlign:'center', animation:'rxFadeUp .5s cubic-bezier(.16,1,.3,1) both' }}>
        <div style={{ width:68, height:68, borderRadius:18, margin:'0 auto 22px', background:'linear-gradient(135deg,rgba(0,255,198,.12),rgba(0,196,255,.08))', border:'1px solid rgba(0,255,198,.18)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:30 }}>🌐</div>
        <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'rgba(255,79,114,.1)', border:'1px solid rgba(255,79,114,.2)', borderRadius:99, padding:'4px 14px', marginBottom:18, fontSize:10, fontWeight:800, color:'var(--rx-rose)', textTransform:'uppercase', letterSpacing:'.1em' }}>Error 404</div>
        <h1 style={{ fontFamily:'var(--rx-font-display)', fontSize:'clamp(26px,5vw,44px)', fontWeight:800, letterSpacing:'-0.04em', color:'var(--rx-t1)', marginBottom:12, lineHeight:1.1 }}>Página no encontrada</h1>
        <p style={{ fontSize:14, color:'var(--rx-t2)', maxWidth:360, margin:'0 auto 28px', lineHeight:1.6 }}>
          La ruta <code style={{ fontFamily:'monospace', fontSize:12, color:'var(--rx-brand)', background:'rgba(0,255,198,.08)', padding:'2px 8px', borderRadius:5 }}>{location.pathname}</code> no existe.
        </p>
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          <button onClick={() => navigate(-1)} className="rx-btn rx-btn-ghost"><ArrowLeft size={14}/> Volver</button>
          <button onClick={() => navigate('/')} className="rx-btn rx-btn-primary"><Home size={14}/> Dashboard</button>
        </div>
        <div style={{ marginTop:32, paddingTop:20, borderTop:'1px solid var(--rx-b1)' }}>
          <p style={{ fontSize:11, color:'var(--rx-t3)', marginBottom:12 }}>Accesos directos:</p>
          <div style={{ display:'flex', gap:7, justifyContent:'center', flexWrap:'wrap' }}>
            {[['Dashboard','/'],['WhatsApp','/whatsapp'],['Llamadas','/calls'],['Agenda','/appointments'],['Ajustes','/settings']].map(([l,t]) => (
              <button key={t} onClick={() => navigate(t)} style={{ background:'var(--rx-s2)', border:'1px solid var(--rx-b1)', borderRadius:99, padding:'4px 12px', fontSize:11, fontWeight:600, color:'var(--rx-t2)', cursor:'pointer' }}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
