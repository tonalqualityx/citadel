/**
 * Seed script for billing dashboard test data
 *
 * Creates test data covering all billing use cases:
 * 1. Ad-hoc tasks (no project, direct client) - SHOULD appear
 * 2. Support tickets - should NOT appear
 * 3. Fixed-price project tasks - should NOT appear (bill via milestones)
 * 4. Hourly project tasks - SHOULD appear
 * 5. Retainer client with overage - SHOULD show overage
 * 6. Triggered milestones - SHOULD appear
 * 7. Non-retainer client tasks - SHOULD appear with full billing
 *
 * Run with: npx tsx scripts/seed-billing-test-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Cleaning up existing billing test data...');

  // Delete in correct order to avoid FK constraints
  await prisma.timeEntry.deleteMany({
    where: { task: { title: { startsWith: '[BILLING-TEST]' } } }
  });
  await prisma.task.deleteMany({
    where: { title: { startsWith: '[BILLING-TEST]' } }
  });
  await prisma.milestone.deleteMany({
    where: { name: { startsWith: '[BILLING-TEST]' } }
  });
  await prisma.project.deleteMany({
    where: { name: { startsWith: '[BILLING-TEST]' } }
  });
  await prisma.client.deleteMany({
    where: { name: { startsWith: '[BILLING-TEST]' } }
  });

  console.log('✅ Cleanup complete\n');

  // Get a user to assign as owner/assignee
  const adminUser = await prisma.user.findFirst({
    where: { role: 'admin' }
  });

  if (!adminUser) {
    throw new Error('No admin user found. Please run the main seed first.');
  }

  console.log(`Using admin user: ${adminUser.name} (${adminUser.id})\n`);

  // ============================================
  // 1. Create Test Clients
  // ============================================
  console.log('📦 Creating test clients...');

  // Agency parent (white-label)
  const agencyClient = await prisma.client.create({
    data: {
      name: '[BILLING-TEST] Partner Agency',
      type: 'agency_partner',
      status: 'active',
      hourly_rate: 150,
    }
  });
  console.log(`  ✓ Agency: ${agencyClient.name}`);

  // Retainer client (under agency) - 10 hours/month
  const retainerClient = await prisma.client.create({
    data: {
      name: '[BILLING-TEST] Retainer Client',
      type: 'sub_client',
      status: 'active',
      hourly_rate: 125,
      retainer_hours: 10,
      parent_agency_id: agencyClient.id,
    }
  });
  console.log(`  ✓ Retainer client: ${retainerClient.name} (10 hrs/mo @ $125)`);

  // Standard hourly client (no retainer)
  const hourlyClient = await prisma.client.create({
    data: {
      name: '[BILLING-TEST] Hourly Client',
      type: 'direct',
      status: 'active',
      hourly_rate: 100,
    }
  });
  console.log(`  ✓ Hourly client: ${hourlyClient.name} ($100/hr)`);

  // Fixed-price project client
  const fixedClient = await prisma.client.create({
    data: {
      name: '[BILLING-TEST] Fixed Price Client',
      type: 'direct',
      status: 'active',
      hourly_rate: 100,
    }
  });
  console.log(`  ✓ Fixed price client: ${fixedClient.name}`);

  // ============================================
  // 2. Create Test Projects
  // ============================================
  console.log('\n📁 Creating test projects...');

  // Hourly billing project
  const hourlyProject = await prisma.project.create({
    data: {
      name: '[BILLING-TEST] Hourly Website Project',
      client_id: hourlyClient.id,
      status: 'in_progress',
      billing_type: 'hourly',
      type: 'project',
    }
  });
  console.log(`  ✓ Hourly project: ${hourlyProject.name}`);

  // Fixed-price project (tasks should NOT appear in billing)
  const fixedProject = await prisma.project.create({
    data: {
      name: '[BILLING-TEST] Fixed Price Redesign',
      client_id: fixedClient.id,
      status: 'in_progress',
      billing_type: 'fixed',
      type: 'project',
      budget_amount: 5000,
    }
  });
  console.log(`  ✓ Fixed project: ${fixedProject.name} ($5000 budget)`);

  // Retainer project
  const retainerProject = await prisma.project.create({
    data: {
      name: '[BILLING-TEST] Retainer Maintenance',
      client_id: retainerClient.id,
      status: 'in_progress',
      billing_type: 'retainer',
      type: 'retainer',
    }
  });
  console.log(`  ✓ Retainer project: ${retainerProject.name}`);

  // ============================================
  // 3. Create Test Tasks
  // ============================================
  console.log('\n📋 Creating test tasks...');

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Task 1: Ad-hoc task (no project, direct client) - SHOULD appear
  const adHocTask = await prisma.task.create({
    data: {
      title: '[BILLING-TEST] Ad-hoc consulting call',
      status: 'done',
      is_billable: true,
      invoiced: false,
      is_support: false,
      client_id: hourlyClient.id,
      project_id: null, // No project!
      assignee_id: adminUser.id,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Ad-hoc task (should appear): ${adHocTask.title}`);

  // Task 2: Support ticket - should NOT appear
  const supportTask = await prisma.task.create({
    data: {
      title: '[BILLING-TEST] Support - Fix login issue',
      status: 'done',
      is_billable: true, // Even though billable, is_support excludes it
      invoiced: false,
      is_support: true, // This should exclude it!
      project_id: hourlyProject.id,
      assignee_id: adminUser.id,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Support ticket (should NOT appear): ${supportTask.title}`);

  // Task 3: Fixed-price project task - should NOT appear
  const fixedTask = await prisma.task.create({
    data: {
      title: '[BILLING-TEST] Design homepage mockup',
      status: 'done',
      is_billable: true,
      invoiced: false,
      is_support: false,
      project_id: fixedProject.id,
      assignee_id: adminUser.id,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Fixed project task (should NOT appear): ${fixedTask.title}`);

  // Task 4: Hourly project task - SHOULD appear
  const hourlyTask = await prisma.task.create({
    data: {
      title: '[BILLING-TEST] Implement contact form',
      status: 'done',
      is_billable: true,
      invoiced: false,
      is_support: false,
      project_id: hourlyProject.id,
      assignee_id: adminUser.id,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Hourly project task (should appear): ${hourlyTask.title}`);

  // Task 5: Retainer task (within limit) - SHOULD appear
  const retainerTask1 = await prisma.task.create({
    data: {
      title: '[BILLING-TEST] Monthly plugin updates',
      status: 'done',
      is_billable: true,
      invoiced: false,
      is_support: false,
      is_retainer_work: true,
      project_id: retainerProject.id,
      assignee_id: adminUser.id,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Retainer task 1 (should appear): ${retainerTask1.title}`);

  // Task 6: Another retainer task (will cause overage) - SHOULD appear
  const retainerTask2 = await prisma.task.create({
    data: {
      title: '[BILLING-TEST] Security patches',
      status: 'done',
      is_billable: true,
      invoiced: false,
      is_support: false,
      is_retainer_work: true,
      project_id: retainerProject.id,
      assignee_id: adminUser.id,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Retainer task 2 (should appear): ${retainerTask2.title}`);

  // Task 7: Already invoiced task - should NOT appear
  const invoicedTask = await prisma.task.create({
    data: {
      title: '[BILLING-TEST] Already invoiced work',
      status: 'done',
      is_billable: true,
      invoiced: true, // Already invoiced!
      is_support: false,
      project_id: hourlyProject.id,
      assignee_id: adminUser.id,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Already invoiced task (should NOT appear): ${invoicedTask.title}`);

  // Task 8: Non-billable task - should NOT appear
  const nonBillableTask = await prisma.task.create({
    data: {
      title: '[BILLING-TEST] Internal meeting notes',
      status: 'done',
      is_billable: false, // Not billable!
      invoiced: false,
      is_support: false,
      project_id: hourlyProject.id,
      assignee_id: adminUser.id,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Non-billable task (should NOT appear): ${nonBillableTask.title}`);

  // ============================================
  // 4. Create Time Entries
  // ============================================
  console.log('\n⏱️  Creating time entries...');

  // Ad-hoc task: 1.5 hours
  await prisma.timeEntry.create({
    data: {
      task_id: adHocTask.id,
      user_id: adminUser.id,
      duration: 90, // 1.5 hours in minutes
      is_billable: true,
      started_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Ad-hoc task: 1.5 hours`);

  // Support task: 30 min (won't show anyway)
  await prisma.timeEntry.create({
    data: {
      task_id: supportTask.id,
      user_id: adminUser.id,
      duration: 30,
      is_billable: true,
      started_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Support task: 0.5 hours`);

  // Fixed project task: 3 hours (won't show anyway)
  await prisma.timeEntry.create({
    data: {
      task_id: fixedTask.id,
      user_id: adminUser.id,
      duration: 180,
      is_billable: true,
      started_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Fixed project task: 3 hours`);

  // Hourly project task: 2.5 hours
  await prisma.timeEntry.create({
    data: {
      task_id: hourlyTask.id,
      user_id: adminUser.id,
      duration: 150,
      is_billable: true,
      started_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Hourly project task: 2.5 hours`);

  // Retainer task 1: 6 hours (within 10hr limit)
  await prisma.timeEntry.create({
    data: {
      task_id: retainerTask1.id,
      user_id: adminUser.id,
      project_id: retainerProject.id, // For retainer tracking
      duration: 360,
      is_billable: true,
      started_at: now, // Current month for retainer calc
    }
  });
  console.log(`  ✓ Retainer task 1: 6 hours`);

  // Retainer task 2: 7 hours (pushes to 13 hours = 3 hours overage!)
  await prisma.timeEntry.create({
    data: {
      task_id: retainerTask2.id,
      user_id: adminUser.id,
      project_id: retainerProject.id,
      duration: 420,
      is_billable: true,
      started_at: now, // Current month for retainer calc
    }
  });
  console.log(`  ✓ Retainer task 2: 7 hours (total 13hrs = 3hrs OVERAGE)`);

  // ============================================
  // 5. Create Triggered Milestones
  // ============================================
  console.log('\n🎯 Creating triggered milestones...');

  // Triggered milestone on fixed project - SHOULD appear
  const milestone1 = await prisma.milestone.create({
    data: {
      name: '[BILLING-TEST] Phase 1 - Discovery Complete',
      project_id: fixedProject.id,
      billing_status: 'triggered',
      billing_amount: 1500,
      triggered_at: oneWeekAgo,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Triggered milestone: ${milestone1.name} ($1,500)`);

  // Another triggered milestone
  const milestone2 = await prisma.milestone.create({
    data: {
      name: '[BILLING-TEST] Phase 2 - Design Approved',
      project_id: fixedProject.id,
      billing_status: 'triggered',
      billing_amount: 2000,
      triggered_at: oneWeekAgo,
      completed_at: oneWeekAgo,
    }
  });
  console.log(`  ✓ Triggered milestone: ${milestone2.name} ($2,000)`);

  // Non-triggered milestone - should NOT appear
  const milestone3 = await prisma.milestone.create({
    data: {
      name: '[BILLING-TEST] Phase 3 - Development',
      project_id: fixedProject.id,
      billing_status: 'pending',
      billing_amount: 1500,
    }
  });
  console.log(`  ✓ Pending milestone (should NOT appear): ${milestone3.name}`);

  // ============================================
  // Summary
  // ============================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 BILLING DASHBOARD TEST DATA SUMMARY');
  console.log('='.repeat(60));

  console.log('\n✅ SHOULD APPEAR on billing dashboard:');
  console.log('   Tasks:');
  console.log('   • [BILLING-TEST] Ad-hoc consulting call (1.5 hrs @ $100 = $150)');
  console.log('   • [BILLING-TEST] Implement contact form (2.5 hrs @ $100 = $250)');
  console.log('   • [BILLING-TEST] Monthly plugin updates (6 hrs - retainer)');
  console.log('   • [BILLING-TEST] Security patches (7 hrs - retainer)');
  console.log('   Milestones:');
  console.log('   • [BILLING-TEST] Phase 1 - Discovery Complete ($1,500)');
  console.log('   • [BILLING-TEST] Phase 2 - Design Approved ($2,000)');

  console.log('\n❌ Should NOT appear:');
  console.log('   • Support ticket (is_support = true)');
  console.log('   • Fixed project task (billing_type = fixed)');
  console.log('   • Already invoiced task (invoiced = true)');
  console.log('   • Non-billable task (is_billable = false)');
  console.log('   • Pending milestone (billing_status = pending)');

  console.log('\n📈 Retainer Overage Test:');
  console.log('   Client: [BILLING-TEST] Retainer Client');
  console.log('   Retainer: 10 hours/month');
  console.log('   Used: 13 hours (6 + 7)');
  console.log('   Overage: 3 hours @ $125 = $375 billable');

  console.log('\n🏢 Agency Hierarchy Test:');
  console.log('   [BILLING-TEST] Retainer Client');
  console.log('   └── via [BILLING-TEST] Partner Agency');

  console.log('\n✨ Done! Visit /billing to test the dashboard.\n');
}

main()
  .catch((e) => {
    console.error('Error seeding billing test data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
