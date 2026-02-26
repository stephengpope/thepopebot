import './globals.css';
import { ThemeProvider } from './components/theme-provider';

export const metadata = {
  title: 'thepopebot',
  description: 'AI Agent',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
