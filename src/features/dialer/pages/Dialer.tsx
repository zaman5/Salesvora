import { ManualDialTab } from "../components/ManualDialTab";

export default function DialerPage() {
  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Dialer</h1>
      </div>
      <ManualDialTab />
    </div>
  );
}