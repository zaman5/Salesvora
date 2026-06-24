// Shared constants, types and tiny UI primitives used by both dialer tabs.

export type NewContact = {
  phone: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  notes: string;
};

export const EMPTY_CONTACT: NewContact = {
  phone: "", firstName: "", lastName: "", company: "", email: "", notes: "",
};

export const STANDARD_FIELDS = [
  { key: "firstName",   label: "First Name" },
  { key: "lastName",    label: "Last Name" },
  { key: "companyName", label: "Company" },
  { key: "designation", label: "Designation" },
  { key: "phone",       label: "Phone" },
  { key: "phone2",      label: "Phone 2" },
  { key: "email",       label: "Email" },
  { key: "address",     label: "Address" },
  { key: "city",        label: "City" },
  { key: "state",       label: "State" },
  { key: "country",     label: "Country" },
  { key: "zipCode",     label: "Zip Code" },
  { key: "website",     label: "Website" },
  { key: "notes",       label: "Notes" },
];

export const DIAL_PAD_DIGITS = ["1","2","3","4","5","6","7","8","9","*","0","#"];

export function formatDur(s: number): string {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

export function TogglePill({
  on,
  onToggle,
  label,
  activeColor = "bg-green-500",
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  activeColor?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
        on
          ? "bg-white/5 border-white/10 text-white"
          : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
      }`}
    >
      <span>{label}</span>
      <div className={`relative w-9 h-5 rounded-full transition-colors ${on ? activeColor : "bg-gray-600"}`}>
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
    </button>
  );
}
