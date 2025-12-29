import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { ProjectStatus, ProjectType, Prisma } from '@prisma/client';

const wizardSchema = z.object({
  recipe_id: z.string().uuid(),
  client_id: z.string().uuid(),
  site_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  pages: z.array(
    z.object({
      name: z.string().min(1),
      page_type: z.string().optional().nullable(),
      selected_variable_tasks: z.array(z.string().uuid()), // Recipe task IDs
    })
  ),
  team_assignments: z.array(
    z.object({
      function_id: z.string().uuid(),
      user_id: z.string().uuid(),
    })
  ),
  start_date: z.string().optional().nullable(),
  target_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = wizardSchema.parse(body);

    // Fetch recipe with phases, tasks, and their SOPs
    const recipe = await prisma.recipe.findUnique({
      where: { id: data.recipe_id },
      include: {
        phases: {
          include: {
            tasks: {
              orderBy: { sort_order: 'asc' },
              include: {
                sop: true, // Include full SOP data for task generation
              },
            },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    if (!recipe) {
      throw new ApiError('Recipe not found', 404);
    }

    if (!recipe.is_active) {
      throw new ApiError('Recipe is inactive', 400);
    }

    // Create project with all related data in transaction
    const project = await prisma.$transaction(async (tx) => {
      // Create project
      const project = await tx.project.create({
        data: {
          name: data.name,
          client_id: data.client_id,
          site_id: data.site_id || undefined,
          recipe_id: data.recipe_id,
          type: recipe.default_type as ProjectType,
          status: ProjectStatus.queue,
          start_date: data.start_date ? new Date(data.start_date) : null,
          target_date: data.target_date ? new Date(data.target_date) : null,
          notes: data.notes || null,
          created_by_id: auth.userId,
        },
      });

      // Create project phases from recipe phases
      const phaseIdMap = new Map<string, string>(); // recipe_phase_id -> project_phase_id
      for (const recipePhase of recipe.phases) {
        const projectPhase = await tx.projectPhase.create({
          data: {
            project_id: project.id,
            name: recipePhase.name,
            icon: recipePhase.icon,
            sort_order: recipePhase.sort_order,
          },
        });
        phaseIdMap.set(recipePhase.id, projectPhase.id);
      }

      // Create project pages
      if (data.pages.length > 0) {
        await tx.projectPage.createMany({
          data: data.pages.map((page, index) => ({
            project_id: project.id,
            name: page.name,
            page_type: page.page_type || null,
            needs_design: false, // Legacy field, kept for compatibility
            sort_order: index,
          })),
        });
      }

      // Create team assignments
      if (data.team_assignments.length > 0) {
        await tx.projectTeamAssignment.createMany({
          data: data.team_assignments.map((assignment) => ({
            project_id: project.id,
            function_id: assignment.function_id,
            user_id: assignment.user_id,
          })),
        });
      }

      // Generate tasks from recipe - SOP is source of truth for task attributes
      const taskIdMap = new Map<string, string>(); // recipe_task_id -> task_id
      let taskSortOrder = 0;

      for (const recipePhase of recipe.phases) {
        const projectPhaseId = phaseIdMap.get(recipePhase.id);

        for (const recipeTask of recipePhase.tasks) {
          const sop = recipeTask.sop;
          if (!sop) {
            throw new ApiError(`SOP not found for recipe task ${recipeTask.id}`, 500);
          }

          // Find assigned user for this function (from SOP)
          const assignment = data.team_assignments.find(
            (a) => a.function_id === sop.function_id
          );

          // Determine task title: use override if set, otherwise SOP title
          const baseTitle = recipeTask.title ?? sop.title;

          if (recipeTask.is_variable && recipeTask.variable_source === 'sitemap_page') {
            // Create one task per page that has this task selected
            for (const page of data.pages) {
              // Only create task if this page selected this variable task
              if (!page.selected_variable_tasks.includes(recipeTask.id)) {
                continue;
              }

              // Replace {page} placeholder in title (case-insensitive)
              const taskTitle = baseTitle.replace(/\{page\}/gi, page.name);

              const task = await tx.task.create({
                data: {
                  project_id: project.id,
                  // Title from override or SOP, with {page} replaced
                  title: taskTitle,
                  description: null, // SOP content is TipTap JSON, not plain text
                  // Phase relationship
                  phase: recipePhase.name, // Legacy string field
                  phase_id: projectPhaseId, // New proper relation
                  // All attributes from SOP
                  priority: sop.default_priority,
                  function_id: sop.function_id,
                  energy_estimate: sop.energy_estimate,
                  mystery_factor: sop.mystery_factor,
                  battery_impact: sop.battery_impact,
                  requirements: sop.template_requirements as Prisma.InputJsonValue | undefined,
                  // Reference back to SOP
                  sop_id: sop.id,
                  // Assignment and metadata
                  assignee_id: assignment?.user_id || null,
                  sort_order: taskSortOrder++,
                  created_by_id: auth.userId,
                },
              });
              // Store mapping (use first page for dependency resolution)
              if (!taskIdMap.has(recipeTask.id)) {
                taskIdMap.set(recipeTask.id, task.id);
              }
            }
          } else {
            // Create single task (non-variable)
            const task = await tx.task.create({
              data: {
                project_id: project.id,
                // Title from override or SOP
                title: baseTitle,
                description: null, // SOP content is TipTap JSON, not plain text
                // Phase relationship
                phase: recipePhase.name, // Legacy string field
                phase_id: projectPhaseId, // New proper relation
                // All attributes from SOP
                priority: sop.default_priority,
                function_id: sop.function_id,
                energy_estimate: sop.energy_estimate,
                mystery_factor: sop.mystery_factor,
                battery_impact: sop.battery_impact,
                requirements: sop.template_requirements as Prisma.InputJsonValue | undefined,
                // Reference back to SOP
                sop_id: sop.id,
                // Assignment and metadata
                assignee_id: assignment?.user_id || null,
                sort_order: taskSortOrder++,
                created_by_id: auth.userId,
              },
            });
            taskIdMap.set(recipeTask.id, task.id);
          }
        }
      }

      // Set up task dependencies based on recipe_task.depends_on_ids
      for (const phase of recipe.phases) {
        for (const recipeTask of phase.tasks) {
          if (recipeTask.depends_on_ids && recipeTask.depends_on_ids.length > 0) {
            const taskId = taskIdMap.get(recipeTask.id);
            if (taskId) {
              const dependencyIds = recipeTask.depends_on_ids
                .map((depId) => taskIdMap.get(depId))
                .filter((id): id is string => !!id);

              if (dependencyIds.length > 0) {
                await tx.task.update({
                  where: { id: taskId },
                  data: {
                    blocked_by: {
                      connect: dependencyIds.map((id) => ({ id })),
                    },
                  },
                });
              }
            }
          }
        }
      }

      return project;
    });

    // Fetch the created project with relations
    const createdProject = await prisma.project.findUnique({
      where: { id: project.id },
      include: {
        client: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        phases: { orderBy: { sort_order: 'asc' } },
        _count: {
          select: {
            tasks: true,
            pages: true,
            team_assignments: true,
          },
        },
      },
    });

    return NextResponse.json({ project: createdProject }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
