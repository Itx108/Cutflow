import './globals.css';

export const metadata = {
  title: 'CutFlow | Salon & Barbershop Management',
  description: 'Reliable salon and barbershop management for South African businesses.',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
