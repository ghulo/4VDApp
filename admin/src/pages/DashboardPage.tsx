const PLANNED_SECTIONS = [
  { title: 'Inventory', description: 'Live stock levels and low stock alerts' },
  { title: 'Products', description: 'Add, edit and remove products with images' },
  { title: 'Sales', description: 'Sales history and revenue trends' },
  { title: 'Pricing', description: 'Bulk pricing tiers per product' },
  { title: 'Users', description: 'Family and employee access' },
];

export function DashboardPage() {
  return (
    <section>
      <h2 className="page-title">Dashboard</h2>
      <p className="page-subtitle">These sections are planned and will be built next.</p>
      <ul className="section-grid">
        {PLANNED_SECTIONS.map((section) => (
          <li key={section.title} className="section-card">
            <h3>{section.title}</h3>
            <p>{section.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
