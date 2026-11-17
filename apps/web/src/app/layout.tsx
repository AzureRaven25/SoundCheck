import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
import { AppShell } from '@/components/shell/AppShell';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const sora = Sora({ variable: '--font-sora', subsets: ['latin'], weight: ['600', '700', '800'] });

export const metadata: Metadata = {
  title: { default: 'SoundCheck', template: '%s · SoundCheck' },
  description: 'Stream music, sing karaoke with your phone as the mic, and get scored like a pro.',
};

export const viewport: Viewport = { themeColor: '#07060c' };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable} h-full`}>
      <body className="h-full overflow-hidden">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
