/**
 * PlaceholderPicker — universal placeholder chip bar
 *
 * Renders a row of clickable chips for {{first_name}}, {{appointment_date}}, etc.
 * When a chip is clicked it inserts the token at the current cursor position
 * in the target <textarea> or <input> (passed via ref).
 *
 * Usage:
 *   const ref = useRef<HTMLTextAreaElement>(null);
 *   <Textarea ref={ref} value={body} onChange={e => setBody(e.target.value)} />
 *   <PlaceholderPicker targetRef={ref} onInsert={token => setBody(prev => prev + token)} showAppointment />
 */

const CONTACT_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{{first_name}}", label: "First Name" },
  { token: "{{last_name}}",  label: "Last Name"  },
  { token: "{{full_name}}",  label: "Full Name"  },
  { token: "{{phone}}",      label: "Phone"      },
  { token: "{{email}}",      label: "Email"      },
  { token: "{{company}}",    label: "Company"    },
];

const APPOINTMENT_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{{appointment_title}}",    label: "Appt Title"    },
  { token: "{{appointment_date}}",     label: "Appt Date"     },
  { token: "{{appointment_time}}",     label: "Appt Time"     },
  { token: "{{appointment_timezone}}", label: "Appt Timezone" },
];

interface PlaceholderPickerProps {
  /** Called with the token string to insert, e.g. "{{first_name}}" */
  onInsert: (token: string) => void;
  /** Optional: ref to the textarea/input so we can insert at cursor position */
  targetRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** When true, also show appointment-specific placeholder chips */
  showAppointment?: boolean;
  className?: string;
}

export function PlaceholderPicker({ onInsert, targetRef, showAppointment = false, className = "" }: PlaceholderPickerProps) {
  const handleClick = (token: string) => {
    const el = targetRef?.current;
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      const newVal = el.value.slice(0, start) + token + el.value.slice(end);
      // Trigger React's synthetic onChange
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(el, newVal);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      // Restore cursor after token
      requestAnimationFrame(() => {
        el.selectionStart = start + token.length;
        el.selectionEnd   = start + token.length;
        el.focus();
      });
    }
    onInsert(token);
  };

  const allPlaceholders = showAppointment
    ? [...CONTACT_PLACEHOLDERS, ...APPOINTMENT_PLACEHOLDERS]
    : CONTACT_PLACEHOLDERS;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      <span className="text-[10px] text-muted-foreground self-center mr-0.5 font-medium uppercase tracking-wide">Insert:</span>
      {allPlaceholders.map(({ token, label }: { token: string; label: string }) => (
        <button
          key={token}
          type="button"
          onClick={() => handleClick(token)}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
