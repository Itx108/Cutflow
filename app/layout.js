import "./globals.css";

export const metadata = {
  title: "CutFlow | Salon & Barbershop Management",
  description: "Bookings, walk-ins, staff, customers, payments and business operations in one reliable workspace.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
