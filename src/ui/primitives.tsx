/**
 * The component vocabulary.
 *
 * Every control in the app is one of these. Nothing below renders a bespoke
 * button or a one-off input — the point of a design system is that a new panel
 * is assembled, not drawn.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon, type Icon } from "./icons";

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

/* ==========================================================================
   Button
   ========================================================================== */

export type ButtonTone = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

export function Button({
  tone = "secondary",
  size = "md",
  icon: LeadIcon,
  trailing: TrailIcon,
  block,
  active,
  className,
  children,
  ...rest
}: {
  tone?: ButtonTone;
  size?: ButtonSize;
  icon?: Icon;
  trailing?: Icon;
  block?: boolean;
  active?: boolean;
  children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const iconSize = size === "sm" ? 14 : size === "lg" ? 18 : 16;
  return (
    <button
      type="button"
      className={cx(
        "btn",
        `btn--${tone}`,
        `btn--${size}`,
        block && "btn--block",
        active && "is-active",
        !children && "btn--icon-only",
        className,
      )}
      {...rest}
    >
      {LeadIcon && <LeadIcon size={iconSize} aria-hidden />}
      {children && <span className="btn__label">{children}</span>}
      {TrailIcon && <TrailIcon size={iconSize} aria-hidden />}
    </button>
  );
}

export function IconButton({
  icon: IconComponent,
  label,
  size = 16,
  tone = "ghost",
  active,
  className,
  ...rest
}: {
  icon: Icon;
  /** Required: an icon with no accessible name is a mystery button. */
  label: string;
  size?: number;
  tone?: "ghost" | "solid" | "danger";
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx("icon-btn", `icon-btn--${tone}`, active && "is-active", className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <IconComponent size={size} aria-hidden />
    </button>
  );
}

/* ==========================================================================
   Text inputs
   ========================================================================== */

export function Input({
  icon: LeadIcon,
  suffix,
  invalid,
  className,
  ...rest
}: {
  icon?: Icon;
  suffix?: ReactNode;
  invalid?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cx("input", invalid && "is-invalid", className)}>
      {LeadIcon && <LeadIcon size={14} className="input__icon" aria-hidden />}
      <input {...rest} />
      {suffix && <span className="input__suffix">{suffix}</span>}
    </span>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <Input
      icon={SearchIcon}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      suffix={
        value ? (
          <button className="input__clear" onClick={() => onChange("")} aria-label="Clear search">
            <CloseIcon size={12} />
          </button>
        ) : undefined
      }
      {...rest}
    />
  );
}

export function NumberField({
  value,
  onCommit,
  min,
  max,
  suffix,
  disabled,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);

  const commit = () => {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) {
      onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed)));
    } else {
      setText(String(Math.round(value)));
    }
  };

  return (
    <Input
      className="input--number numeric"
      value={text}
      disabled={disabled}
      suffix={suffix}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(String(Math.round(value)));
      }}
    />
  );
}

/* ==========================================================================
   Select
   ========================================================================== */

export function Select<T extends string>({
  value,
  onChange,
  options,
  icon: LeadIcon,
  size = "md",
  className,
  ...rest
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  icon?: Icon;
  size?: "sm" | "md";
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "size">) {
  return (
    <span className={cx("select", `select--${size}`, className)}>
      {LeadIcon && <LeadIcon size={14} className="select__icon" aria-hidden />}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={14} className="select__chevron" aria-hidden />
    </span>
  );
}

/* ==========================================================================
   Switch, checkbox, segmented
   ========================================================================== */

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  hideLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /** Keep the accessible name but drop the visible row — for table cells. */
  hideLabel?: boolean;
}) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx("switch", checked && "is-on")}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" />
    </button>
  );
  if (!label || hideLabel) return control;
  return (
    <label className="switch-row">
      <span className="switch-row__text">
        <span className="switch-row__label">{label}</span>
        {hint && <span className="switch-row__hint">{hint}</span>}
      </span>
      {control}
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cx("checkbox", disabled && "is-disabled")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="checkbox__box" aria-hidden>
        <CheckIcon size={11} weight="Filled" />
      </span>
      {label && <span className="checkbox__label">{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: Icon }>;
  size?: "sm" | "md";
}) {
  return (
    <div className={cx("segmented", `segmented--${size}`)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          className={cx("segmented__item", value === option.value && "is-active")}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <option.icon size={14} aria-hidden />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
}) {
  return (
    <span className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {format && <span className="slider__value numeric">{format(value)}</span>}
    </span>
  );
}

/* ==========================================================================
   Badges, pills, avatars
   ========================================================================== */

export function Badge({
  tone = "neutral",
  children,
  dot,
}: {
  tone?: "neutral" | "live" | "success" | "warning" | "danger" | "accent";
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={cx("badge", `badge--${tone}`)}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}

/** The one thing that means "this is on air". Never used for anything else. */
export function LiveBadge({ label = "Live" }: { label?: string }) {
  return <span className="live-badge">{label}</span>;
}

/** Deterministic colour per name, so one person is one colour everywhere. */
export function whoColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `var(--who-${(hash % 8) + 1})`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  size = 24,
  src,
}: {
  name: string;
  size?: number;
  src?: string;
}) {
  return (
    <span
      className="avatar"
      title={name}
      style={{
        width: size,
        height: size,
        background: src ? undefined : whoColor(name),
        fontSize: Math.max(9, Math.round(size * 0.4)),
      }}
    >
      {src ? <img src={src} alt={name} /> : initials(name)}
    </span>
  );
}

export function AvatarStack({
  names,
  max = 4,
  size = 24,
}: {
  names: string[];
  max?: number;
  size?: number;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((name) => (
        <Avatar key={name} name={name} size={size} />
      ))}
      {extra > 0 && (
        <span className="avatar avatar--more" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

/* ==========================================================================
   Tabs
   ========================================================================== */

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: Array<{ value: T; label: string; count?: number }>;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          className={cx("tabs__tab", value === tab.value && "is-active")}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tabs__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ==========================================================================
   Layout pieces
   ========================================================================== */

export function Field({
  label,
  hint,
  children,
  inline,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
  inline?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx("field", inline && "field--inline")}>
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="field__control">{children}</div>
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

export function Group({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("group", className)}>
      {(title || action) && (
        <header className="group__head">
          {title && <h3 className="eyebrow">{title}</h3>}
          {action}
        </header>
      )}
      <div className="group__body">{children}</div>
    </section>
  );
}

export function EmptyState({
  icon: IconComponent,
  title,
  hint,
  action,
}: {
  icon?: Icon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {IconComponent && <IconComponent size={22} className="empty__icon" aria-hidden />}
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
      {action}
    </div>
  );
}

/* ==========================================================================
   Modal
   ========================================================================== */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 720,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-layer" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle && <div className="modal__subtitle">{subtitle}</div>}
          </div>
          <IconButton icon={CloseIcon} label="Close" onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ==========================================================================
   Dropdown menu
   ========================================================================== */

export type MenuEntry =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      icon?: Icon;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    };

export function Menu({
  entries,
  x,
  y,
  onClose,
  align = "start",
}: {
  entries: MenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(align === "end" ? x - rect.width : x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y, align]);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    // Deferred so the click that opened the menu does not immediately close it.
    const timer = window.setTimeout(() => window.addEventListener("mousedown", dismiss));
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="menu" ref={ref} style={pos} role="menu">
      {entries.map((entry, index) =>
        entry.separator ? (
          <div className="menu__rule" key={`rule-${index}`} />
        ) : (
          <button
            key={entry.label}
            role="menuitem"
            className={cx("menu__item", entry.danger && "is-danger")}
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
          >
            {entry.icon ? (
              <entry.icon size={15} aria-hidden />
            ) : entry.checked !== undefined ? (
              <span className="menu__check">{entry.checked && <CheckIcon size={13} />}</span>
            ) : (
              <span className="menu__check" />
            )}
            <span className="menu__label">{entry.label}</span>
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Convenience wrapper: a trigger button that opens a menu beneath itself. */
export function MenuButton({
  entries,
  children,
  align = "end",
  ...buttonProps
}: {
  entries: MenuEntry[];
  children?: ReactNode;
  align?: "start" | "end";
} & Omit<Parameters<typeof Button>[0], "onClick">) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="menu-anchor" ref={ref}>
      <Button
        {...buttonProps}
        active={!!open}
        onClick={() => {
          const rect = ref.current?.getBoundingClientRect();
          if (!rect) return;
          setOpen(open ? null : { x: align === "end" ? rect.right : rect.left, y: rect.bottom + 6 });
        }}
      >
        {children}
      </Button>
      {open && <Menu entries={entries} x={open.x} y={open.y} align={align} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ==========================================================================
   Tooltip
   ========================================================================== */

const TooltipContext = createContext<{ show: (text: string, el: HTMLElement) => void; hide: () => void } | null>(
  null,
);

export function TooltipHost({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);

  const value = {
    show: (text: string, el: HTMLElement) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const rect = el.getBoundingClientRect();
        setTip({ text, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
      }, 420);
    },
    hide: () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      setTip(null);
    },
  };

  return (
    <TooltipContext.Provider value={value}>
      {children}
      {tip &&
        createPortal(
          <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
            {tip.text}
          </div>,
          document.body,
        )}
    </TooltipContext.Provider>
  );
}

export function useTooltip(text: string) {
  const ctx = useContext(TooltipContext);
  if (!ctx) return {};
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => ctx.show(text, e.currentTarget),
    onMouseLeave: () => ctx.hide(),
    onMouseDown: () => ctx.hide(),
  };
}

export { cx };
