// Editable lead-fields panel — renders a configurable set of Input/Textarea
// fields for the current lead, auto-saving each field on blur.
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User } from "lucide-react";
import { STANDARD_FIELDS } from "./shared";

export interface FieldDef { key: string; label: string; }

interface LeadFieldsPanelProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentLead: any | null;
  displayFields: string[];
  allFields: FieldDef[];
  fieldMenuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleField: (key: string) => void;
  getFieldValue: (key: string) => string;
  setFieldValue: (key: string, val: string) => void;
  saveField: (key: string) => void;
  isSaving?: boolean;
  /** Optional badge label override */
  badgeLabel?: string;
}

export function LeadFieldsPanel({
  currentLead,
  displayFields,
  allFields,
  fieldMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onToggleField,
  getFieldValue,
  setFieldValue,
  saveField,
  isSaving,
  badgeLabel = "Current",
}: LeadFieldsPanelProps) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-300 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-blue-400" />
          </div>
          {currentLead ? (
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                {getFieldValue("firstName")} {getFieldValue("lastName") || getFieldValue("companyName") || "Lead"}
              </h3>
              <p className="text-xs text-gray-500">Lead #{currentLead.id}</p>
            </div>
          ) : (
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Searching…</h3>
              <p className="text-xs text-gray-500">Finding next pending lead</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {currentLead && (
            <div className="relative">
              <Button
                size="sm"
                className={`h-7 text-xs font-semibold px-2 ${fieldMenuOpen ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600"}`}
                onClick={onToggleMenu}
              >
                Fields ▾
              </Button>
              {fieldMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={onCloseMenu} />
                  <div className="absolute right-0 mt-1 z-20 w-60 max-h-72 overflow-auto bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl p-2 shadow-2xl">
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 px-2 py-1.5 sticky top-0 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 mb-1">
                      Show these fields
                    </p>
                    {allFields.map((f) => (
                      <label
                        key={f.key}
                        className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="accent-blue-500 w-4 h-4"
                          checked={displayFields.includes(f.key)}
                          onChange={() => onToggleField(f.key)}
                        />
                        <span className="truncate">{f.label}</span>
                        {f.key.startsWith("cf:") && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300 px-1.5 py-0.5 rounded ml-auto shrink-0">
                            Excel
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">{badgeLabel}</Badge>
        </div>
      </div>

      {/* Editable fields */}
      {currentLead ? (
        <div className="space-y-2 overflow-y-auto max-h-[300px]">
          {displayFields.length === 0 && (
            <p className="text-xs text-gray-500">No fields selected. Click "Fields" to choose.</p>
          )}
          {displayFields.map((fk) => {
            const f = allFields.find((x) => x.key === fk);
            if (!f) return null;
            return (
              <div key={fk}>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{f.label}</label>
                {fk === "notes" ? (
                  <Textarea
                    value={getFieldValue(fk)}
                    onChange={(e) => setFieldValue(fk, e.target.value)}
                    onBlur={() => saveField(fk)}
                    placeholder={f.label}
                    className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 mt-0.5 text-sm min-h-[55px]"
                  />
                ) : (
                  <Input
                    value={getFieldValue(fk)}
                    onChange={(e) => setFieldValue(fk, e.target.value)}
                    onBlur={() => saveField(fk)}
                    placeholder={f.label}
                    className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 mt-0.5 text-sm h-8"
                  />
                )}
              </div>
            );
          })}
          {isSaving && <p className="text-xs text-blue-400">Saving…</p>}
        </div>
      ) : (
        <p className="text-center text-gray-500 text-sm py-4">
          Waiting for next pending campaign lead…
        </p>
      )}
    </div>
  );
}

export { STANDARD_FIELDS };
