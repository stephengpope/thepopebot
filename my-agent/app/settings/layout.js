import { auth } from 'thepopebot/auth';
import { SettingsLayout } from 'thepopebot/chat';

export default async function Layout({ children }) {
  const session = await auth();
  return <SettingsLayout session={session}>{children}</SettingsLayout>;
}
