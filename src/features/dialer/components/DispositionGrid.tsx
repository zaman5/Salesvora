// Call-result (disposition) selection grid used after a call ends.
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Radio, Hash, Ban } from "lucide-react";

export interface Disposition {
  id: number;
  label?: string;
  name?: string;
  category: string;
}

interface DispositionGridProps {
  dispositions: Disposition[];
  selected: string | null;
  onSelect: (id: string) => void;
}

function dispIcon(category: string) {
  if (category === "connected" || category === "converted") return <CheckCircle2 className="w-4 h-4" />;
  if (category === "no_answer")                              return <XCircle className="w-4 h-4" />;
  if (category === "machine" || category === "voicemail")   return <Radio className="w-4 h-4" />;
  if (category === "wrong_number")                          return <Hash className="w-4 h-4" />;
  return <Ban className="w-4 h-4" />;
}

export function DispositionGrid({ dispositions, selected, onSelect }: DispositionGridProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-100">Select Call Result</p>
      <div className="grid grid-cols-2 gap-2">
        {dispositions.map((disp) => (
          <Button
            key={disp.id}
            size="sm"
            onClick={() => onSelect(disp.id.toString())}
            className={`justify-start text-white h-10 border transition-colors ${
              selected === disp.id.toString()
                ? "bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400 border-blue-500"
                : "bg-gray-800 hover:bg-gray-700 border-gray-700 hover:border-gray-500"
            }`}
          >
            {dispIcon(disp.category)}
            <span className="ml-2 truncate text-sm">{disp.label ?? disp.name}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
