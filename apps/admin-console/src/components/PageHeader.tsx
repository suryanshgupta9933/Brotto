interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: '2rem',
      paddingBottom: '1rem',
      borderBottom: '1px solid #333'
    }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 600, marginBottom: '0.5rem' }}>{title}</h1>
        {description && (
          <p style={{ color: '#888', fontSize: '0.95rem' }}>{description}</p>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: '0.75rem' }}>{actions}</div>}
    </div>
  )
}
