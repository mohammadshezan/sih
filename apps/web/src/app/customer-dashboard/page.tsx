export default function CustomerDashboardAlias() {
  if (typeof window !== 'undefined') {
    window.location.replace('/customer/dashboard');
  }
  return null;
}
