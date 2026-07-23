import { AutoCampaignTab } from "../components/AutoCampaignTab";

export default function AutoDialerPage() {
  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Auto Dialer</h1>
        <p className="text-xs text-gray-500 mt-0.5">Automated campaign calling</p>
      </div>
      <AutoCampaignTab />
    </div>
  );
}