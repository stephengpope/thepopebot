import { redirect } from 'next/navigation';

export default function SettingsRoot() {
  redirect('/settings/crons');
}
