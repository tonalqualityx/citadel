import { PrismaClient, UserRole, ClientType, ClientStatus, ProjectStatus, ProjectType, TaskStatus, MysteryFactor, BatteryImpact } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Map to track created entities by name for relationship building
const clientMap = new Map<string, string>(); // name -> id
const siteMap = new Map<string, string>(); // name -> id
const userMap = new Map<string, string>(); // email -> id
const functionMap = new Map<string, string>(); // name -> id
const projectMap = new Map<string, string>(); // name -> id

// Helper to parse CSV with multi-line field support
function parseCSV(content: string): Record<string, string>[] {
  // Remove BOM if present
  content = content.replace(/^\uFEFF/, '');

  if (!content.trim()) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
      if (char === '\r') i++; // Skip \n in \r\n
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f)) { // Skip empty rows
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else if (char !== '\r') {
      currentField += char;
    }
  }

  // Handle last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return [];

  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] || '';
    });
    return obj;
  });
}

async function main() {
  console.log('🌱 Seeding database...');

  // Create test users (one per role)
  const passwordHash = await bcrypt.hash('password123', 10);

  const users = [
    {
      email: 'admin@indelible.agency',
      name: 'Admin User',
      role: UserRole.admin,
      password_hash: passwordHash,
    },
    {
      email: 'pm@indelible.agency',
      name: 'PM User',
      role: UserRole.pm,
      password_hash: passwordHash,
    },
    {
      email: 'tech@indelible.agency',
      name: 'Tech User',
      role: UserRole.tech,
      password_hash: passwordHash,
    },
  ];

  for (const user of users) {
    const created = await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: user,
    });
    userMap.set(user.email, created.id);
    console.log(`  ✓ Created user: ${user.email}`);
  }

  // Seed from CSV files
  const seedDir = path.join(__dirname, '../../implementation/seed');

  // Functions
  try {
    const functionsFile = fs.readdirSync(path.join(seedDir, 'functions')).find(f => f.endsWith('_all.csv'));
    if (functionsFile) {
      const content = fs.readFileSync(path.join(seedDir, 'functions', functionsFile), 'utf-8');
      const rows = parseCSV(content);

      await prisma.function.deleteMany();
      let sortOrder = 1;
      for (const row of rows) {
        if (row['Name']) {
          const fn = await prisma.function.create({
            data: {
              name: row['Name'],
              primary_focus: row['Primary Focus'] || null,
              sort_order: sortOrder++,
            },
          });
          functionMap.set(row['Name'].toLowerCase(), fn.id);
        }
      }
      console.log(`  ✓ Created ${rows.length} functions from CSV`);
    }
  } catch (e) {
    console.log('  ⚠ Functions CSV not found, using defaults');
    const defaultFunctions = [
      { name: 'Project Manager', primary_focus: 'Project orchestration and client communication', sort_order: 1 },
      { name: 'Designer', primary_focus: 'UI/UX design and mockups', sort_order: 2 },
      { name: 'Developer', primary_focus: 'Site building and functionality', sort_order: 3 },
      { name: 'Network Admin', primary_focus: 'Hosting and infrastructure', sort_order: 4 },
    ];
    await prisma.function.deleteMany();
    for (const fn of defaultFunctions) {
      const created = await prisma.function.create({ data: fn });
      functionMap.set(fn.name.toLowerCase(), created.id);
    }
    console.log(`  ✓ Created ${defaultFunctions.length} default functions`);
  }

  // Hosting Plans
  try {
    const hostingFile = fs.readdirSync(path.join(seedDir, 'hosting')).find(f => f.endsWith('_all.csv'));
    if (hostingFile) {
      const content = fs.readFileSync(path.join(seedDir, 'hosting', hostingFile), 'utf-8');
      const rows = parseCSV(content);

      await prisma.hostingPlan.deleteMany();
      let created = 0;
      for (const row of rows) {
        // CSV columns: Name, Agency Rate, Details, Margin, Monthly Cost, Profit, Rate, Tags, Vendor Plan
        if (row['Name']) {
          const rate = row['Rate'] ? parseFloat(row['Rate'].replace(/[^0-9.]/g, '')) : 0;
          const agencyRate = row['Agency Rate'] ? parseFloat(row['Agency Rate'].replace(/[^0-9.]/g, '')) : null;
          const monthlyCost = row['Monthly Cost'] ? parseFloat(row['Monthly Cost'].replace(/[^0-9.]/g, '')) : null;

          await prisma.hostingPlan.create({
            data: {
              name: row['Name'],
              rate: rate,
              agency_rate: agencyRate,
              monthly_cost: monthlyCost,
              vendor_plan: row['Vendor Plan'] || null,
              details: row['Details'] || null,
            },
          });
          created++;
        }
      }
      console.log(`  ✓ Created ${created} hosting plans from CSV`);
    }
  } catch (e) {
    console.log('  ⚠ Hosting CSV not found, using defaults', e);
    const defaultHosting = [
      { name: 'Starter', rate: 29.99, monthly_cost: 10.00, vendor_plan: 'Basic' },
      { name: 'Professional', rate: 59.99, monthly_cost: 25.00, vendor_plan: 'Standard' },
      { name: 'Enterprise', rate: 149.99, monthly_cost: 75.00, vendor_plan: 'Premium' },
    ];
    await prisma.hostingPlan.deleteMany();
    await prisma.hostingPlan.createMany({ data: defaultHosting });
    console.log(`  ✓ Created ${defaultHosting.length} default hosting plans`);
  }

  // Maintenance Plans
  try {
    const maintenanceFile = fs.readdirSync(path.join(seedDir, 'maintenance')).find(f => f.endsWith('_all.csv'));
    if (maintenanceFile) {
      const content = fs.readFileSync(path.join(seedDir, 'maintenance', maintenanceFile), 'utf-8');
      const rows = parseCSV(content);

      await prisma.maintenancePlan.deleteMany();
      for (const row of rows) {
        if (row['Name']) {
          // CSV columns: Name, Agency Rate, Description, Monthly Rate, Notes
          const rate = row['Monthly Rate'] ? parseFloat(row['Monthly Rate'].replace(/[^0-9.]/g, '')) : 0;
          const agencyRate = row['Agency Rate'] ? parseFloat(row['Agency Rate'].replace(/[^0-9.]/g, '')) : null;
          // Extract hours from Description if mentioned (e.g., "Up to 2 hours content updates")
          const description = row['Description'] || '';
          const hoursMatch = description.match(/(\d+)\s*hours?/i);
          const hours = hoursMatch ? parseFloat(hoursMatch[1]) : null;

          await prisma.maintenancePlan.create({
            data: {
              name: row['Name'],
              rate: rate,
              agency_rate: agencyRate,
              hours: hours,
              details: row['Description'] || row['Notes'] || null,
            },
          });
        }
      }
      console.log(`  ✓ Created ${rows.filter(r => r['Name']).length} maintenance plans from CSV`);
    }
  } catch (e) {
    console.log('  ⚠ Maintenance CSV not found, using defaults', e);
    const defaultMaintenance = [
      { name: 'Basic', rate: 99.00, hours: 2.0 },
      { name: 'Standard', rate: 249.00, hours: 5.0 },
      { name: 'Premium', rate: 499.00, hours: 12.0 },
    ];
    await prisma.maintenancePlan.deleteMany();
    await prisma.maintenancePlan.createMany({ data: defaultMaintenance });
    console.log(`  ✓ Created ${defaultMaintenance.length} default maintenance plans`);
  }

  // Tools
  try {
    const toolsFile = fs.readdirSync(path.join(seedDir, 'tools')).find(f => f.endsWith('_all.csv'));
    if (toolsFile) {
      const content = fs.readFileSync(path.join(seedDir, 'tools', toolsFile), 'utf-8');
      const rows = parseCSV(content);

      await prisma.tool.deleteMany();
      for (const row of rows) {
        if (row['Name']) {
          await prisma.tool.create({
            data: {
              name: row['Name'],
              description: row['Description'] || null,
              url: row['Site'] || null,
              category: row['Tag'] || null,
              license_key: row['License'] || null,
            },
          });
        }
      }
      console.log(`  ✓ Created tools from CSV`);
    }
  } catch (e) {
    console.log('  ⚠ Tools CSV not found, skipping');
  }

  // Clear existing client data (in reverse order due to foreign keys)
  // First, clear project-related data that depends on clients
  await prisma.projectPage.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectTeamAssignment.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.project.deleteMany();
  // Then clear site/domain data
  await prisma.domain.deleteMany();
  await prisma.site.deleteMany();
  await prisma.client.deleteMany();

  // Agency Partners (type = agency_partner)
  try {
    const agencyFile = fs.readdirSync(path.join(seedDir, 'agency-partners')).find(f => f.endsWith('_all.csv'));
    if (agencyFile) {
      const content = fs.readFileSync(path.join(seedDir, 'agency-partners', agencyFile), 'utf-8');
      const rows = parseCSV(content);

      for (const row of rows) {
        if (row['Name'] && row['Name'].trim()) {
          const client = await prisma.client.create({
            data: {
              name: row['Name'].trim(),
              type: ClientType.agency_partner,
              status: ClientStatus.active,
            },
          });
          clientMap.set(row['Name'].trim().toLowerCase(), client.id);
        }
      }
      console.log(`  ✓ Created ${rows.filter(r => r['Name']).length} agency partners from CSV`);
    }
  } catch (e) {
    console.log('  ⚠ Agency Partners CSV not found, skipping');
  }

  // Clients (type = direct)
  try {
    const clientsFile = fs.readdirSync(path.join(seedDir, 'clients')).find(f => f.endsWith('_all.csv'));
    if (clientsFile) {
      const content = fs.readFileSync(path.join(seedDir, 'clients', clientsFile), 'utf-8');
      const rows = parseCSV(content);

      for (const row of rows) {
        if (row['Business'] && row['Business'].trim()) {
          // Parse status
          let status: ClientStatus = ClientStatus.active;
          const statusValue = row['Client Status']?.toLowerCase() || '';
          if (statusValue.includes('inactive')) status = ClientStatus.inactive;
          if (statusValue.includes('delinquent')) status = ClientStatus.delinquent;

          // Parse hourly rate
          const hourlyRate = row['Hourly Rate'] ? parseFloat(row['Hourly Rate'].replace(/[^0-9.]/g, '')) : null;

          // Parse retainer hours (Maint. Hrs.)
          const retainerHours = row['Maint. Hrs.'] ? parseFloat(row['Maint. Hrs.'].replace(/[^0-9.]/g, '')) : null;

          const client = await prisma.client.create({
            data: {
              name: row['Business'].trim(),
              type: ClientType.direct,
              status,
              primary_contact: row['Contact Person'] || null,
              email: row['Email Address'] || null,
              phone: row['Phone Number'] || null,
              hourly_rate: hourlyRate,
              retainer_hours: retainerHours,
            },
          });
          clientMap.set(row['Business'].trim().toLowerCase(), client.id);

          // Create a default site for this client using the domain from Contact Indicators if present
          const siteName = row['Contact Indicators'] || row['Business'].trim();
          const siteUrl = row['Contact Indicators']?.includes('.')
            ? `https://${row['Contact Indicators'].split(',')[0].trim()}`
            : null;

          const site = await prisma.site.create({
            data: {
              name: siteName.split(',')[0].trim(),
              url: siteUrl,
              client_id: client.id,
              hosted_by: 'indelible',
            },
          });
          siteMap.set(siteName.split(',')[0].trim().toLowerCase(), site.id);
        }
      }
      console.log(`  ✓ Created ${rows.filter(r => r['Business']).length} clients with sites from CSV`);
    }
  } catch (e) {
    console.log('  ⚠ Clients CSV not found, using defaults');
    // Create a few sample clients
    const sampleClients = [
      { name: 'Acme Corp', type: ClientType.direct, status: ClientStatus.active, email: 'contact@acme.example.com' },
      { name: 'Widget Inc', type: ClientType.direct, status: ClientStatus.active, email: 'info@widget.example.com' },
    ];
    for (const c of sampleClients) {
      const client = await prisma.client.create({ data: c });
      clientMap.set(c.name.toLowerCase(), client.id);
    }
    console.log(`  ✓ Created ${sampleClients.length} sample clients`);
  }

  // Domains
  try {
    const domainsFile = fs.readdirSync(path.join(seedDir, 'domains')).find(f => f.endsWith('_all.csv'));
    if (domainsFile) {
      const content = fs.readFileSync(path.join(seedDir, 'domains', domainsFile), 'utf-8');
      const rows = parseCSV(content);

      // Get or create a default "Indelible" client for orphaned domains
      let indelibleClientId = clientMap.get('indelible');
      if (!indelibleClientId) {
        const indelibleClient = await prisma.client.create({
          data: {
            name: 'Indelible',
            type: ClientType.direct,
            status: ClientStatus.active,
          },
        });
        indelibleClientId = indelibleClient.id;
        clientMap.set('indelible', indelibleClientId);
      }

      let domainsCreated = 0;
      for (const row of rows) {
        if (row['Name'] && row['Name'].trim()) {
          const domainName = row['Name'].trim();

          // Check if domain already exists (skip duplicates)
          if (siteMap.has(domainName.toLowerCase())) {
            continue;
          }

          // Try to find the site from the Site column or Client column
          let siteId: string | null = null;
          let clientId: string | null = null;

          // Extract site name from the CSV (format: "Site Name (https://...)")
          const siteRef = row['🕸️ Site'] || row['Site'] || '';
          const siteNameMatch = siteRef.match(/^([^(]+)/);
          const siteName = siteNameMatch ? siteNameMatch[1].trim() : null;

          if (siteName) {
            siteId = siteMap.get(siteName.toLowerCase()) || null;
          }

          // If no site found, try to find client
          if (!siteId) {
            const clientRef = row['🧑‍🚀 Client'] || row['Client'] || '';
            const clientNameMatch = clientRef.match(/^([^(]+)/);
            const clientName = clientNameMatch ? clientNameMatch[1].trim() : null;

            if (clientName) {
              clientId = clientMap.get(clientName.toLowerCase()) || null;
            }
          }

          // Determine hosting type
          const managedBy = row['Managed By'] || '';
          const hostedBy = managedBy.toLowerCase().includes('indelible') ? 'indelible' as const :
                          managedBy.toLowerCase().includes('client') ? 'client' as const : 'other' as const;

          // If no site exists, create one
          if (!siteId) {
            // Use found client or fall back to Indelible
            const siteClientId = clientId || indelibleClientId;

            const site = await prisma.site.create({
              data: {
                name: domainName,
                url: `https://${domainName}`,
                client_id: siteClientId,
                hosted_by: hostedBy,
              },
            });
            siteId = site.id;
            siteMap.set(domainName.toLowerCase(), site.id);
          }

          // Parse expiration date
          let expiresAt: Date | null = null;
          if (row['Expiration Date']) {
            const dateStr = row['Expiration Date'].trim();
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
              expiresAt = parsed;
            }
          }

          await prisma.domain.create({
            data: {
              name: domainName,
              site_id: siteId,
              registrar: row['Registration Platform'] || row['DNS Provider'] || null,
              expires_at: expiresAt,
              is_primary: true,
            },
          });
          domainsCreated++;
        }
      }
      console.log(`  ✓ Created ${domainsCreated} domains from CSV`);
    }
  } catch (e) {
    console.log('  ⚠ Domains CSV not found, skipping', e);
  }

  // ============================================
  // PROJECTS (PACTS) & TASKS (QUESTS)
  // ============================================

  // Clear existing project/task data
  await prisma.timeEntry.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectTeamAssignment.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.project.deleteMany();

  // Get user IDs
  const pmUserId = userMap.get('pm@indelible.agency');
  const techUserId = userMap.get('tech@indelible.agency');
  const adminUserId = userMap.get('admin@indelible.agency');

  // Get function IDs
  const devFunctionId = functionMap.get('developer') || functionMap.get('web development');
  const designFunctionId = functionMap.get('designer') || functionMap.get('design');
  const pmFunctionId = functionMap.get('project manager') || functionMap.get('project management');

  // Get first few clients with sites for projects
  const clientsWithSites = await prisma.client.findMany({
    where: { is_deleted: false },
    include: { sites: { take: 1 } },
    take: 5,
  });

  console.log('\n🏰 Creating Pacts (Projects)...');

  // Sample projects with various statuses
  const sampleProjects = [
    {
      name: 'Website Redesign',
      description: 'Complete overhaul of the company website with modern design and improved UX.',
      status: ProjectStatus.in_progress,
      type: ProjectType.project,
      budget_hours: 120,
      budget_amount: 15000,
      start_date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 2 weeks ago
      target_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 1 month from now
    },
    {
      name: 'E-Commerce Integration',
      description: 'Add shopping cart functionality and payment gateway integration.',
      status: ProjectStatus.ready,
      type: ProjectType.project,
      budget_hours: 80,
      budget_amount: 10000,
      start_date: new Date(),
      target_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
    },
    {
      name: 'Monthly Maintenance',
      description: 'Ongoing website maintenance, updates, and support.',
      status: ProjectStatus.in_progress,
      type: ProjectType.retainer,
      is_retainer: true,
      budget_hours: 10,
    },
    {
      name: 'SEO Optimization',
      description: 'Improve search engine rankings through technical SEO and content optimization.',
      status: ProjectStatus.quote,
      type: ProjectType.project,
      budget_hours: 40,
      budget_amount: 5000,
    },
    {
      name: 'Mobile App Landing Page',
      description: 'Create a landing page for the upcoming mobile app launch.',
      status: ProjectStatus.done,
      type: ProjectType.project,
      budget_hours: 24,
      budget_amount: 3000,
      start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      target_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      completed_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
    {
      name: 'Content Management System',
      description: 'Implement a custom CMS for easy content updates.',
      status: ProjectStatus.review,
      type: ProjectType.project,
      budget_hours: 60,
      budget_amount: 8000,
      start_date: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
      target_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      name: 'Internal Tools Dashboard',
      description: 'Build internal dashboard for team productivity tracking.',
      status: ProjectStatus.in_progress,
      type: ProjectType.internal,
      budget_hours: 50,
    },
  ];

  for (let i = 0; i < sampleProjects.length; i++) {
    const projectData = sampleProjects[i];
    const client = clientsWithSites[i % clientsWithSites.length];
    const site = client?.sites[0];

    const project = await prisma.project.create({
      data: {
        ...projectData,
        client_id: client?.id,
        site_id: site?.id,
        created_by_id: pmUserId || adminUserId || undefined,
      },
    });

    projectMap.set(projectData.name.toLowerCase(), project.id);
    console.log(`  ✓ Created pact: ${projectData.name} (${projectData.status})`);

    // Add team assignments for active projects
    if (['ready', 'in_progress', 'review'].includes(projectData.status) && pmUserId && techUserId) {
      await prisma.projectTeamAssignment.createMany({
        data: [
          { project_id: project.id, user_id: pmUserId, function_id: pmFunctionId, is_lead: true },
          { project_id: project.id, user_id: techUserId, function_id: devFunctionId, is_lead: false },
        ],
      });
    }
  }

  console.log('\n⚔️ Creating Quests (Tasks)...');

  // Sample tasks for the in-progress projects
  const redesignProjectId = projectMap.get('website redesign');
  const cmsProjectId = projectMap.get('content management system');
  const internalProjectId = projectMap.get('internal tools dashboard');
  const ecommerceProjectId = projectMap.get('e-commerce integration');

  // Helper to calculate estimated minutes from energy level
  const energyToMinutes = (energy: number, mystery: MysteryFactor): number => {
    const baseMinutes: Record<number, number> = {
      1: 15, 2: 30, 3: 60, 4: 120, 5: 240, 6: 480, 7: 960, 8: 1920
    };
    const multipliers: Record<MysteryFactor, number> = {
      none: 1.0, average: 1.4, significant: 1.75, no_idea: 2.5
    };
    return Math.round(baseMinutes[energy] * multipliers[mystery]);
  };

  const sampleTasks = [
    // Website Redesign tasks
    {
      title: 'Design homepage mockups',
      description: 'Create 3 design options for the new homepage layout.',
      project_id: redesignProjectId,
      status: TaskStatus.done,
      priority: 2,
      phase: 'Design',
      energy_estimate: 5,
      mystery_factor: MysteryFactor.none,
      function_id: designFunctionId,
      assignee_id: techUserId,
      requirements: [
        { id: crypto.randomUUID(), text: 'Hero section with video background', completed: true, completed_at: new Date().toISOString(), sort_order: 0 },
        { id: crypto.randomUUID(), text: 'Featured products grid', completed: true, completed_at: new Date().toISOString(), sort_order: 1 },
        { id: crypto.randomUUID(), text: 'Testimonials carousel', completed: true, completed_at: new Date().toISOString(), sort_order: 2 },
      ],
    },
    {
      title: 'Build responsive navigation',
      description: 'Implement mobile-friendly navigation with hamburger menu.',
      project_id: redesignProjectId,
      status: TaskStatus.in_progress,
      priority: 2,
      phase: 'Development',
      energy_estimate: 4,
      mystery_factor: MysteryFactor.average,
      function_id: devFunctionId,
      assignee_id: techUserId,
      requirements: [
        { id: crypto.randomUUID(), text: 'Desktop mega menu', completed: true, completed_at: new Date().toISOString(), sort_order: 0 },
        { id: crypto.randomUUID(), text: 'Mobile slide-out menu', completed: false, completed_at: null, sort_order: 1 },
        { id: crypto.randomUUID(), text: 'Search integration', completed: false, completed_at: null, sort_order: 2 },
      ],
    },
    {
      title: 'Implement contact form',
      description: 'Create contact form with validation and email notifications.',
      project_id: redesignProjectId,
      status: TaskStatus.not_started,
      priority: 3,
      phase: 'Development',
      energy_estimate: 3,
      mystery_factor: MysteryFactor.none,
      function_id: devFunctionId,
    },
    {
      title: 'Set up analytics tracking',
      description: 'Integrate Google Analytics and set up conversion goals.',
      project_id: redesignProjectId,
      status: TaskStatus.not_started,
      priority: 4,
      phase: 'Launch',
      energy_estimate: 2,
      mystery_factor: MysteryFactor.average,
    },
    {
      title: 'Performance optimization',
      description: 'Optimize images, implement lazy loading, and improve Core Web Vitals.',
      project_id: redesignProjectId,
      status: TaskStatus.blocked,
      priority: 2,
      phase: 'Development',
      energy_estimate: 4,
      mystery_factor: MysteryFactor.significant,
      notes: 'Blocked until navigation is complete.',
    },

    // CMS tasks
    {
      title: 'Design admin dashboard UI',
      description: 'Create UI mockups for the CMS admin panel.',
      project_id: cmsProjectId,
      status: TaskStatus.done,
      priority: 2,
      phase: 'Design',
      energy_estimate: 4,
      mystery_factor: MysteryFactor.none,
      function_id: designFunctionId,
    },
    {
      title: 'Build content editor',
      description: 'Implement rich text editor with media uploads.',
      project_id: cmsProjectId,
      status: TaskStatus.review,
      priority: 1,
      phase: 'Development',
      energy_estimate: 6,
      mystery_factor: MysteryFactor.average,
      function_id: devFunctionId,
      assignee_id: techUserId,
      requirements: [
        { id: crypto.randomUUID(), text: 'Rich text formatting', completed: true, completed_at: new Date().toISOString(), sort_order: 0 },
        { id: crypto.randomUUID(), text: 'Image upload and resize', completed: true, completed_at: new Date().toISOString(), sort_order: 1 },
        { id: crypto.randomUUID(), text: 'Embed support (YouTube, etc)', completed: true, completed_at: new Date().toISOString(), sort_order: 2 },
        { id: crypto.randomUUID(), text: 'Draft/Publish workflow', completed: false, completed_at: null, sort_order: 3 },
      ],
    },
    {
      title: 'API documentation',
      description: 'Document the CMS API endpoints for developers.',
      project_id: cmsProjectId,
      status: TaskStatus.not_started,
      priority: 3,
      phase: 'Documentation',
      energy_estimate: 3,
      mystery_factor: MysteryFactor.none,
    },

    // Internal tools tasks
    {
      title: 'Set up project structure',
      description: 'Initialize the dashboard project with Next.js and configure build pipeline.',
      project_id: internalProjectId,
      status: TaskStatus.done,
      priority: 1,
      phase: 'Setup',
      energy_estimate: 3,
      mystery_factor: MysteryFactor.none,
      function_id: devFunctionId,
      assignee_id: techUserId,
    },
    {
      title: 'Implement authentication',
      description: 'Add SSO login with company credentials.',
      project_id: internalProjectId,
      status: TaskStatus.in_progress,
      priority: 1,
      phase: 'Development',
      energy_estimate: 5,
      mystery_factor: MysteryFactor.significant,
      function_id: devFunctionId,
      assignee_id: techUserId,
    },
    {
      title: 'Build time tracking widget',
      description: 'Create a widget for logging work hours.',
      project_id: internalProjectId,
      status: TaskStatus.not_started,
      priority: 2,
      phase: 'Development',
      energy_estimate: 4,
      mystery_factor: MysteryFactor.average,
    },

    // E-commerce tasks (ready status project)
    {
      title: 'Research payment gateways',
      description: 'Compare Stripe, PayPal, and Square for best fit.',
      project_id: ecommerceProjectId,
      status: TaskStatus.done,
      priority: 1,
      phase: 'Planning',
      energy_estimate: 3,
      mystery_factor: MysteryFactor.none,
    },
    {
      title: 'Design product page template',
      description: 'Create responsive product detail page with image gallery.',
      project_id: ecommerceProjectId,
      status: TaskStatus.not_started,
      priority: 2,
      phase: 'Design',
      energy_estimate: 4,
      mystery_factor: MysteryFactor.average,
      function_id: designFunctionId,
    },
    {
      title: 'Implement shopping cart',
      description: 'Build cart functionality with local storage persistence.',
      project_id: ecommerceProjectId,
      status: TaskStatus.not_started,
      priority: 1,
      phase: 'Development',
      energy_estimate: 5,
      mystery_factor: MysteryFactor.average,
      function_id: devFunctionId,
    },

    // Ad-hoc tasks (no project)
    {
      title: 'Update SSL certificates',
      description: 'Renew and install SSL certificates for all client sites.',
      project_id: null,
      status: TaskStatus.not_started,
      priority: 1,
      phase: null,
      energy_estimate: 2,
      mystery_factor: MysteryFactor.none,
      assignee_id: techUserId,
    },
    {
      title: 'Weekly backup verification',
      description: 'Verify all automated backups completed successfully.',
      project_id: null,
      status: TaskStatus.done,
      priority: 3,
      phase: null,
      energy_estimate: 1,
      mystery_factor: MysteryFactor.none,
      assignee_id: techUserId,
    },
  ];

  let taskCount = 0;
  const createdTasks: { id: string; title: string }[] = [];

  for (const taskData of sampleTasks) {
    const energy = taskData.energy_estimate || 3;
    const mystery = taskData.mystery_factor || MysteryFactor.none;

    const task = await prisma.task.create({
      data: {
        title: taskData.title,
        description: taskData.description || undefined,
        project_id: taskData.project_id || undefined,
        status: taskData.status,
        priority: taskData.priority,
        phase: taskData.phase || undefined,
        energy_estimate: energy,
        mystery_factor: mystery,
        estimated_minutes: energyToMinutes(energy, mystery),
        function_id: taskData.function_id || undefined,
        assignee_id: taskData.assignee_id || undefined,
        notes: taskData.notes || undefined,
        requirements: taskData.requirements || undefined,
        created_by_id: pmUserId || adminUserId || undefined,
        started_at: ['in_progress', 'review', 'done'].includes(taskData.status) ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : undefined,
        completed_at: taskData.status === 'done' ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) : undefined,
        sort_order: taskCount,
      },
    });
    createdTasks.push({ id: task.id, title: taskData.title });
    taskCount++;
  }

  // Add blocking relationship (Performance optimization blocked by Navigation)
  const perfTask = createdTasks.find(t => t.title === 'Performance optimization');
  const navTask = createdTasks.find(t => t.title === 'Build responsive navigation');
  if (perfTask && navTask) {
    await prisma.task.update({
      where: { id: perfTask.id },
      data: {
        blocked_by: { connect: { id: navTask.id } },
      },
    });
  }

  console.log(`  ✓ Created ${taskCount} quests across ${sampleProjects.length} pacts`);

  // ============================================
  // RECIPES (RITUALS) FOR WIZARD
  // ============================================

  console.log('\n📜 Creating Rituals (Recipes)...');

  // Define task type for recipe tasks
  interface RecipeTaskData {
    title: string;
    titleOverride?: string; // Optional override for RecipeTask.title
    priority: number;
    energy: number;
    mystery: MysteryFactor;
    batteryImpact?: BatteryImpact;
    isVariable?: boolean;
    variableSource?: string;
    functionName?: string;
  }

  interface RecipePhaseData {
    name: string;
    sort_order: number;
    tasks: RecipeTaskData[];
  }

  // Clear existing recipe data
  await prisma.recipeTask.deleteMany();
  await prisma.recipePhase.deleteMany();
  await prisma.recipe.deleteMany();

  // First, create SOPs for each unique task template
  // SOPs are the source of truth for task attributes in the new schema
  const sopMap = new Map<string, string>(); // title -> sop_id

  async function getOrCreateSop(taskData: RecipeTaskData): Promise<string> {
    const key = taskData.title;
    if (sopMap.has(key)) {
      return sopMap.get(key)!;
    }

    const functionId = taskData.functionName ? functionMap.get(taskData.functionName) : undefined;

    const sop = await prisma.sop.create({
      data: {
        title: taskData.title,
        default_priority: taskData.priority,
        energy_estimate: taskData.energy,
        mystery_factor: taskData.mystery,
        battery_impact: taskData.batteryImpact || BatteryImpact.average_drain,
        function_id: functionId,
        is_active: true,
        tags: ['recipe-template'],
      },
    });

    sopMap.set(key, sop.id);
    return sop.id;
  }

  // Recipe 1: Full Website Build (requires sitemap for variable tasks)
  const fullWebsiteRecipe = await prisma.recipe.create({
    data: {
      name: 'Full Website Build',
      description: 'Complete website project from discovery to launch. Includes design, development, and deployment phases.',
      default_type: ProjectType.project,
      requires_sitemap: true, // Has variable tasks
      is_active: true,
    },
  });

  const fullWebsitePhases: RecipePhaseData[] = [
    {
      name: 'Discovery',
      sort_order: 0,
      tasks: [
        { title: 'Client kickoff meeting', priority: 1, energy: 2, mystery: MysteryFactor.none },
        { title: 'Gather brand assets', priority: 2, energy: 2, mystery: MysteryFactor.average },
        { title: 'Competitive analysis', priority: 3, energy: 3, mystery: MysteryFactor.average },
        { title: 'Define sitemap and IA', priority: 2, energy: 3, mystery: MysteryFactor.none },
      ],
    },
    {
      name: 'Design',
      sort_order: 1,
      tasks: [
        { title: 'Page Design', titleOverride: 'Design {page}', priority: 2, energy: 4, mystery: MysteryFactor.average, isVariable: true, variableSource: 'sitemap_page', functionName: 'designer' },
        { title: 'Design review with client', priority: 2, energy: 2, mystery: MysteryFactor.average },
        { title: 'Revisions round 1', priority: 3, energy: 3, mystery: MysteryFactor.significant },
        { title: 'Final design approval', priority: 1, energy: 1, mystery: MysteryFactor.none },
      ],
    },
    {
      name: 'Development',
      sort_order: 2,
      tasks: [
        { title: 'Set up development environment', priority: 1, energy: 2, mystery: MysteryFactor.none, functionName: 'developer' },
        { title: 'Page Build', titleOverride: 'Build {page}', priority: 2, energy: 4, mystery: MysteryFactor.average, isVariable: true, variableSource: 'sitemap_page', functionName: 'developer' },
        { title: 'Implement responsive design', priority: 2, energy: 4, mystery: MysteryFactor.average, functionName: 'developer' },
        { title: 'Form integrations', priority: 3, energy: 3, mystery: MysteryFactor.average, functionName: 'developer' },
        { title: 'Browser testing', priority: 2, energy: 2, mystery: MysteryFactor.none, functionName: 'developer' },
      ],
    },
    {
      name: 'Launch',
      sort_order: 3,
      tasks: [
        { title: 'Content migration', priority: 2, energy: 4, mystery: MysteryFactor.significant },
        { title: 'SEO setup', priority: 3, energy: 2, mystery: MysteryFactor.none },
        { title: 'Analytics installation', priority: 3, energy: 1, mystery: MysteryFactor.none },
        { title: 'Client training', priority: 2, energy: 2, mystery: MysteryFactor.average },
        { title: 'Go live', priority: 1, energy: 2, mystery: MysteryFactor.average, functionName: 'developer' },
        { title: 'Post-launch QA', priority: 1, energy: 2, mystery: MysteryFactor.none },
      ],
    },
  ];

  for (const phaseData of fullWebsitePhases) {
    const phase = await prisma.recipePhase.create({
      data: {
        recipe_id: fullWebsiteRecipe.id,
        name: phaseData.name,
        sort_order: phaseData.sort_order,
      },
    });

    for (let i = 0; i < phaseData.tasks.length; i++) {
      const taskData = phaseData.tasks[i];
      const sopId = await getOrCreateSop(taskData);

      await prisma.recipeTask.create({
        data: {
          phase_id: phase.id,
          sop_id: sopId,
          title: taskData.titleOverride || null, // Override title if different from SOP
          is_variable: taskData.isVariable || false,
          variable_source: taskData.variableSource || null,
          sort_order: i,
          depends_on_ids: [],
        },
      });
    }
  }

  console.log(`  ✓ Created recipe: ${fullWebsiteRecipe.name}`);

  // Recipe 2: Landing Page (no sitemap needed)
  const landingPageRecipe = await prisma.recipe.create({
    data: {
      name: 'Landing Page',
      description: 'Single page website or campaign landing page. Quick turnaround project.',
      default_type: ProjectType.project,
      requires_sitemap: false,
      is_active: true,
    },
  });

  const landingPagePhases: RecipePhaseData[] = [
    {
      name: 'Design',
      sort_order: 0,
      tasks: [
        { title: 'Gather copy and assets', priority: 1, energy: 2, mystery: MysteryFactor.average },
        { title: 'Design landing page', priority: 1, energy: 4, mystery: MysteryFactor.average, functionName: 'designer' },
        { title: 'Client review', priority: 2, energy: 1, mystery: MysteryFactor.none },
      ],
    },
    {
      name: 'Development',
      sort_order: 1,
      tasks: [
        { title: 'Build landing page', priority: 1, energy: 4, mystery: MysteryFactor.none, functionName: 'developer' },
        { title: 'Form setup', priority: 2, energy: 2, mystery: MysteryFactor.none, functionName: 'developer' },
        { title: 'Mobile optimization', priority: 2, energy: 2, mystery: MysteryFactor.none, functionName: 'developer' },
      ],
    },
    {
      name: 'Launch',
      sort_order: 2,
      tasks: [
        { title: 'Tracking setup', priority: 2, energy: 1, mystery: MysteryFactor.none },
        { title: 'Deploy to production', priority: 1, energy: 1, mystery: MysteryFactor.none, functionName: 'developer' },
      ],
    },
  ];

  for (const phaseData of landingPagePhases) {
    const phase = await prisma.recipePhase.create({
      data: {
        recipe_id: landingPageRecipe.id,
        name: phaseData.name,
        sort_order: phaseData.sort_order,
      },
    });

    for (let i = 0; i < phaseData.tasks.length; i++) {
      const taskData = phaseData.tasks[i];
      const sopId = await getOrCreateSop(taskData);

      await prisma.recipeTask.create({
        data: {
          phase_id: phase.id,
          sop_id: sopId,
          title: taskData.titleOverride || null,
          is_variable: false,
          sort_order: i,
          depends_on_ids: [],
        },
      });
    }
  }

  console.log(`  ✓ Created recipe: ${landingPageRecipe.name}`);

  // Recipe 3: E-Commerce Site (requires sitemap)
  const ecommerceRecipe = await prisma.recipe.create({
    data: {
      name: 'E-Commerce Site',
      description: 'Full online store with product catalog, cart, and checkout functionality.',
      default_type: ProjectType.project,
      requires_sitemap: true, // Has variable tasks
      is_active: true,
    },
  });

  const ecommercePhases: RecipePhaseData[] = [
    {
      name: 'Planning',
      sort_order: 0,
      tasks: [
        { title: 'Requirements gathering', priority: 1, energy: 3, mystery: MysteryFactor.average },
        { title: 'Product catalog structure', priority: 2, energy: 2, mystery: MysteryFactor.average },
        { title: 'Payment gateway selection', priority: 1, energy: 2, mystery: MysteryFactor.none },
        { title: 'Shipping integration research', priority: 2, energy: 2, mystery: MysteryFactor.average },
      ],
    },
    {
      name: 'Design',
      sort_order: 1,
      tasks: [
        { title: 'Page Design', titleOverride: 'Design {page}', priority: 2, energy: 4, mystery: MysteryFactor.average, isVariable: true, variableSource: 'sitemap_page', functionName: 'designer' },
        { title: 'Design product page template', priority: 1, energy: 4, mystery: MysteryFactor.average, functionName: 'designer' },
        { title: 'Design cart and checkout flow', priority: 1, energy: 5, mystery: MysteryFactor.average, functionName: 'designer' },
      ],
    },
    {
      name: 'Development',
      sort_order: 2,
      tasks: [
        { title: 'Set up e-commerce platform', priority: 1, energy: 4, mystery: MysteryFactor.average, functionName: 'developer' },
        { title: 'Page Build', titleOverride: 'Build {page}', priority: 2, energy: 4, mystery: MysteryFactor.average, isVariable: true, variableSource: 'sitemap_page', functionName: 'developer' },
        { title: 'Product catalog implementation', priority: 1, energy: 5, mystery: MysteryFactor.average, functionName: 'developer' },
        { title: 'Shopping cart functionality', priority: 1, energy: 5, mystery: MysteryFactor.significant, functionName: 'developer' },
        { title: 'Checkout and payment integration', priority: 1, energy: 6, mystery: MysteryFactor.significant, functionName: 'developer' },
        { title: 'Order management system', priority: 2, energy: 4, mystery: MysteryFactor.average, functionName: 'developer' },
        { title: 'Email notifications', priority: 2, energy: 3, mystery: MysteryFactor.average, functionName: 'developer' },
      ],
    },
    {
      name: 'Testing',
      sort_order: 3,
      tasks: [
        { title: 'Payment testing', priority: 1, energy: 3, mystery: MysteryFactor.average },
        { title: 'Order flow testing', priority: 1, energy: 3, mystery: MysteryFactor.average },
        { title: 'Mobile testing', priority: 2, energy: 2, mystery: MysteryFactor.none },
      ],
    },
    {
      name: 'Launch',
      sort_order: 4,
      tasks: [
        { title: 'Product data import', priority: 1, energy: 4, mystery: MysteryFactor.significant },
        { title: 'Go live', priority: 1, energy: 2, mystery: MysteryFactor.average, functionName: 'developer' },
        { title: 'Client training', priority: 2, energy: 3, mystery: MysteryFactor.average },
      ],
    },
  ];

  for (const phaseData of ecommercePhases) {
    const phase = await prisma.recipePhase.create({
      data: {
        recipe_id: ecommerceRecipe.id,
        name: phaseData.name,
        sort_order: phaseData.sort_order,
      },
    });

    for (let i = 0; i < phaseData.tasks.length; i++) {
      const taskData = phaseData.tasks[i];
      const sopId = await getOrCreateSop(taskData);

      await prisma.recipeTask.create({
        data: {
          phase_id: phase.id,
          sop_id: sopId,
          title: taskData.titleOverride || null,
          is_variable: taskData.isVariable || false,
          variable_source: taskData.variableSource || null,
          sort_order: i,
          depends_on_ids: [],
        },
      });
    }
  }

  console.log(`  ✓ Created recipe: ${ecommerceRecipe.name}`);

  // ============================================
  // SOPS (RUNES) - Additional SOPs from CSV
  // ============================================

  console.log('\n📜 Creating Additional Runes (SOPs) from CSV...');

  // Note: We don't delete SOPs here because RecipeTasks reference them
  // SOPs for recipe tasks were already created above

  try {
    const sopsFile = fs.readdirSync(path.join(seedDir, 'sops')).find(f => f.endsWith('_all.csv'));
    if (sopsFile) {
      const content = fs.readFileSync(path.join(seedDir, 'sops', sopsFile), 'utf-8');
      const rows = parseCSV(content);

      let sopCount = 0;
      for (const row of rows) {
        if (row['Name'] && row['Name'].trim()) {
          // Parse status (🟢 = active, 🔴 = inactive/draft)
          const statusEmoji = row['Status'] || '';
          const isActive = statusEmoji.includes('🟢');

          // Parse tags (comma-separated)
          const tagsStr = row['Tags'] || '';
          const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);

          // Parse dates
          let lastReviewedAt: Date | null = null;
          let nextReviewAt: Date | null = null;

          if (row['Last Reviewed']) {
            const parsed = new Date(row['Last Reviewed']);
            if (!isNaN(parsed.getTime())) {
              lastReviewedAt = parsed;
            }
          }

          if (row['Next Review']) {
            const parsed = new Date(row['Next Review']);
            if (!isNaN(parsed.getTime())) {
              nextReviewAt = parsed;
            }
          }

          // Parse functions - extract names from format: "Function Name (https://...)"
          const functionsStr = row['💼 Functions'] || row['Functions'] || '';
          const functionMatches = functionsStr.match(/([^,()]+)\s*\([^)]+\)/g) || [];
          const functionNames = functionMatches.map(m => m.replace(/\s*\([^)]+\)/, '').trim());

          // Get the first matching function ID
          let functionId: string | undefined;
          for (const fnName of functionNames) {
            const foundId = functionMap.get(fnName.toLowerCase());
            if (foundId) {
              functionId = foundId;
              break;
            }
          }

          // Estimate energy/time based on tags
          let energyEstimate = 3; // Default medium
          let estimatedMinutes = 60; // Default 1 hour
          let batteryImpact: 'average_drain' | 'high_drain' | 'energizing' = 'average_drain';

          // Adjust based on tags
          if (tags.some(t => t.toLowerCase().includes('meeting') || t.toLowerCase().includes('client'))) {
            batteryImpact = 'high_drain';
            energyEstimate = 3;
            estimatedMinutes = 60;
          } else if (tags.some(t => t.toLowerCase().includes('content') || t.toLowerCase().includes('strategy'))) {
            batteryImpact = 'high_drain';
            energyEstimate = 4;
            estimatedMinutes = 120;
          } else if (tags.some(t => t.toLowerCase().includes('design') || t.toLowerCase().includes('figma'))) {
            energyEstimate = 4;
            estimatedMinutes = 180;
          } else if (tags.some(t => t.toLowerCase().includes('wordpress') || t.toLowerCase().includes('hosting'))) {
            energyEstimate = 4;
            estimatedMinutes = 120;
          }

          await prisma.sop.create({
            data: {
              title: row['Name'].trim(),
              tags: tags,
              is_active: isActive,
              function_id: functionId || null,
              last_reviewed_at: lastReviewedAt,
              next_review_at: nextReviewAt,
              // Task template defaults
              default_priority: 3,
              energy_estimate: energyEstimate,
              mystery_factor: MysteryFactor.average,
              battery_impact: batteryImpact,
              estimated_minutes: estimatedMinutes,
            },
          });
          sopCount++;
        }
      }
      console.log(`  ✓ Created ${sopCount} SOPs from CSV`);
    }
  } catch (e) {
    console.log('  ⚠ SOPs CSV not found, creating defaults');
    // Default SOPs with full task template data
    const defaultSops = [
      {
        title: 'Site Setup',
        tags: ['Hosting', 'Wordpress'],
        is_active: true,
        default_priority: 2,
        energy_estimate: 4,
        mystery_factor: MysteryFactor.average,
        battery_impact: BatteryImpact.average_drain,
        estimated_minutes: 120,
        template_requirements: [
          { id: crypto.randomUUID(), text: 'Create staging site on WPMU Dev', completed: false, sort_order: 0 },
          { id: crypto.randomUUID(), text: 'Install required plugins', completed: false, sort_order: 1 },
          { id: crypto.randomUUID(), text: 'Configure basic settings', completed: false, sort_order: 2 },
          { id: crypto.randomUUID(), text: 'Set up SSL certificate', completed: false, sort_order: 3 },
        ],
        content: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Site Setup Procedure' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'This SOP covers the standard process for setting up a new WordPress site on our hosting network.' }] },
            { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Step 1: Create Staging Site' }] },
            { type: 'orderedList', content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Log into WPMU Dev dashboard' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Navigate to Sites > Add New' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Select appropriate hosting plan based on client tier' }] }] },
            ]},
          ],
        },
      },
      {
        title: 'Page Build',
        tags: ['Cornerstone', 'Wordpress'],
        is_active: true,
        default_priority: 3,
        energy_estimate: 5,
        mystery_factor: MysteryFactor.average,
        battery_impact: BatteryImpact.average_drain,
        estimated_minutes: 180,
        template_requirements: [
          { id: crypto.randomUUID(), text: 'Review design mockup', completed: false, sort_order: 0 },
          { id: crypto.randomUUID(), text: 'Build page structure', completed: false, sort_order: 1 },
          { id: crypto.randomUUID(), text: 'Add content and images', completed: false, sort_order: 2 },
          { id: crypto.randomUUID(), text: 'Mobile responsive check', completed: false, sort_order: 3 },
          { id: crypto.randomUUID(), text: 'Cross-browser testing', completed: false, sort_order: 4 },
        ],
      },
      {
        title: 'Creating Forms',
        tags: ['Forms', 'Wordpress'],
        is_active: true,
        default_priority: 3,
        energy_estimate: 3,
        mystery_factor: MysteryFactor.none,
        battery_impact: BatteryImpact.average_drain,
        estimated_minutes: 60,
        template_requirements: [
          { id: crypto.randomUUID(), text: 'Create form in Gravity Forms', completed: false, sort_order: 0 },
          { id: crypto.randomUUID(), text: 'Configure email notifications', completed: false, sort_order: 1 },
          { id: crypto.randomUUID(), text: 'Set up confirmation message', completed: false, sort_order: 2 },
          { id: crypto.randomUUID(), text: 'Test form submission', completed: false, sort_order: 3 },
        ],
      },
      {
        title: 'Client Onboarding',
        tags: ['Client Meetings'],
        is_active: true,
        default_priority: 2,
        energy_estimate: 3,
        mystery_factor: MysteryFactor.average,
        battery_impact: BatteryImpact.high_drain, // Client meetings are draining
        estimated_minutes: 90,
        template_requirements: [
          { id: crypto.randomUUID(), text: 'Send welcome email', completed: false, sort_order: 0 },
          { id: crypto.randomUUID(), text: 'Schedule kickoff call', completed: false, sort_order: 1 },
          { id: crypto.randomUUID(), text: 'Collect brand assets', completed: false, sort_order: 2 },
          { id: crypto.randomUUID(), text: 'Set up project in system', completed: false, sort_order: 3 },
        ],
      },
      {
        title: 'Content Strategy',
        tags: ['Content Strategy'],
        is_active: true,
        default_priority: 2,
        energy_estimate: 4,
        mystery_factor: MysteryFactor.significant, // Content strategy varies a lot
        battery_impact: BatteryImpact.high_drain,
        estimated_minutes: 180,
        template_requirements: [
          { id: crypto.randomUUID(), text: 'Review existing content', completed: false, sort_order: 0 },
          { id: crypto.randomUUID(), text: 'Identify content gaps', completed: false, sort_order: 1 },
          { id: crypto.randomUUID(), text: 'Create content outline', completed: false, sort_order: 2 },
          { id: crypto.randomUUID(), text: 'Get client approval', completed: false, sort_order: 3 },
        ],
      },
    ];

    for (const sop of defaultSops) {
      await prisma.sop.create({ data: sop });
    }
    console.log(`  ✓ Created ${defaultSops.length} default SOPs with task templates`);
  }

  console.log('\n✅ Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
