import { PrismaClient, TaskStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🕐 Seeding timeclock issues test data...\n');

  // Get all users to create test data for each
  const users = await prisma.user.findMany({
    where: { is_active: true },
    select: { id: true, name: true, email: true },
  });

  if (users.length === 0) {
    console.log('❌ No users found. Run the main seed first.');
    return;
  }

  console.log(`Found ${users.length} users\n`);

  // Get a project to associate tasks with
  const project = await prisma.project.findFirst({
    where: { is_deleted: false },
    include: { client: true },
  });

  for (const user of users) {
    console.log(`Creating test data for: ${user.name} (${user.email})`);

    // 1. Create a completed task with no time entries
    const completedTask = await prisma.task.create({
      data: {
        title: `[TEST] Completed task with no time - ${user.name}`,
        description: 'This task was completed but has no time logged against it.',
        status: TaskStatus.done,
        priority: 3,
        assignee_id: user.id,
        project_id: project?.id,
        client_id: project?.client_id,
        completed_at: new Date(),
        no_time_needed: false, // Explicitly false so it shows up
        created_by_id: user.id,
      },
    });
    console.log(`  ✓ Created completed task: ${completedTask.id}`);

    // 2. Create a running time entry (timer started but not stopped)
    // First, create or find a task for this timer
    const timerTask = await prisma.task.create({
      data: {
        title: `[TEST] Task with running timer - ${user.name}`,
        description: 'This task has a timer that was started but never stopped.',
        status: TaskStatus.in_progress,
        priority: 2,
        assignee_id: user.id,
        project_id: project?.id,
        client_id: project?.client_id,
        created_by_id: user.id,
      },
    });

    // Create a running time entry (started 2 hours ago, no end time)
    const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const runningTimer = await prisma.timeEntry.create({
      data: {
        user_id: user.id,
        task_id: timerTask.id,
        project_id: project?.id,
        started_at: startedAt,
        ended_at: null,
        duration: 0,
        is_running: true,
        description: 'Timer started but not stopped',
      },
    });
    console.log(`  ✓ Created running timer: ${runningTimer.id} (started ${startedAt.toLocaleString()})`);

    console.log('');
  }

  console.log('✅ Timeclock issues test data created!');
  console.log('\nTo view these issues:');
  console.log('1. Log in as any user');
  console.log('2. Go to the dashboard/overlook page');
  console.log('3. You should see the "Timeclock Issues" widget');
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
