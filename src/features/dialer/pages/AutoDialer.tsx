import { useState } from "react";
import { ManualDialTab }    from "../components/ManualDialTab";
import { AutoCampaignTab }  from "../components/AutoCampaignTab";

export default function AutoDialerPage() {
  const [mode, setMode] = useState<"manual" | "auto">("manual");

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Tab header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Dialer</h1>
          <p className="text-xs text-gray-500 mt-0.5">Manual or automated campaign calling</p>
        </div>
        <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setMode("manual")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "manual" ? "bg-blue-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            Manual Dial
          </button>
          <button
            onClick={() => setMode("auto")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "auto" ? "bg-blue-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            Auto Campaign
          </button>
        </div>
      </div>

      {mode === "manual" ? <ManualDialTab /> : <AutoCampaignTab />}
    </div>
  );
}
