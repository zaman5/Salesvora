// Reusable 3×4 numeric keypad used in both Manual and Auto dialer.
import { DIAL_PAD_DIGITS } from "./shared";

interface DialPadProps {
  /** Called when a digit button is pressed */
  onDigit: (digit: string) => void;
  /** Height of each button (Tailwind class, default "h-11") */
  buttonHeight?: string;
}

export function DialPad({ onDigit, buttonHeight = "h-11" }: DialPadProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {DIAL_PAD_DIGITS.map((d) => (
        <button
          key={d}
          onClick={() => onDigit(d)}
          className={`${buttonHeight} rounded-lg bg-gray-800 text-white font-medium text-lg hover:bg-gray-700 active:bg-gray-600 active:scale-95 transition-all border border-gray-700/50`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
