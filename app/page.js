import Link from "next/link";

export default function Home() {
  return <main className="hero"><section className="hero-card"><div className="brand">Cut<span>Flow</span></div><div className="kicker">Salon & barbershop operations</div><h1>Bookings. Walk-ins. Staff. Stock. Sales.</h1><p>CutFlow keeps the daily work of a salon or barbershop organised in one practical system, built for phones, tablets and computers.</p><div className="actions"><Link className="btn primary" href="/login">Business login</Link></div></section></main>;
}
