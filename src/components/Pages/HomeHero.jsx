import "./HomeHero.css";
import { publicAsset } from '../../utils/assets';
import { BMLogo } from '../Common/BMLogo';

const Arrow = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>;

export const HomeHero = ({ setPage }) => (
  <section className="bm-home-hero" aria-labelledby="bm-home-hero-title">
    <img className="bm-home-hero__backdrop" src={publicAsset('image/hero/bm-home-hero-v2.png')} alt="BM Printing Services owner in a professional printing workspace" />
    <div className="bm-home-hero__content">
      <div className="bm-home-hero__brand" aria-label="BM Printing Services">
        <BMLogo size={76}/>
        <div><strong>BM Printing</strong><span>Services</span></div>
      </div>
      <p className="bm-home-hero__brandline">PRINT <i/> DESIGN <i/> CREATE <i/> DELIVER</p>
      <h1 id="bm-home-hero-title"><span>Your Trusted</span><strong>Printing Partner</strong></h1>
      <p className="bm-home-hero__tagline">Quality Prints for Every Need.</p>
      <div className="bm-home-hero__actions">
        <button type="button" className="is-primary" onClick={() => setPage('products')}>Browse Products <Arrow/></button>
        <button type="button" className="is-secondary" onClick={() => setPage('order')}>Place Order <Arrow/></button>
      </div>
    </div>
  </section>
);
