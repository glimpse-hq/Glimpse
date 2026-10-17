type ApiKeyFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
};

const ApiKeyField = ({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: ApiKeyFieldProps) => (
  <div className="flex h-7 items-center rounded-md border border-border-primary px-2.5 transition-colors hover:border-border-secondary focus-within:border-border-hover">
    <input
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoComplete="off"
      spellCheck={false}
      className="api-key-input w-full bg-transparent ui-text-body-sm ui-color-primary placeholder-content-disabled focus:outline-none"
    />
  </div>
);

export default ApiKeyField;
