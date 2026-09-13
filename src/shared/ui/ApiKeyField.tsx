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
  <div className="mt-2 border-b border-border-secondary transition-colors focus-within:border-content-primary">
    <input
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoComplete="off"
      spellCheck={false}
      className="api-key-input w-full bg-transparent px-0.5 py-1 ui-text-body-sm ui-color-primary placeholder-content-disabled focus:outline-none"
    />
  </div>
);

export default ApiKeyField;
