import { Router } from "express";
import { createPod, deletePod } from '../kubernetes/pod.js';
import { createService, deleteService } from '../kubernetes/service.js';
import { createSandboxKey } from '../config/redis.js';
import { v7 as uuid } from "uuid"
import { authMiddleware } from "../middlewares/auth.middleware.js";
import Project from "../models/project.model.js";

const router = Router();

async function teardown(sandboxId) {
    await Promise.allSettled([
        deletePod(sandboxId),
        deleteService(sandboxId),
    ]);
}

router.post('/project', authMiddleware, async (req, res) => {
    const { title } = req.body;

    const newProject = new Project({
        user: req.user.id,
        title
    });

    await newProject.save();

    return res.status(201).json({
        message: 'Project created successfully',
        project: newProject
    });
})

router.post("/start", authMiddleware, async (req, res) => {
    const projectId = req.body.projectId;

    const project = await Project.findOne({ _id: projectId, user: req.user.id });
    if (!project) {
        return res.status(404).json({ message: 'Project not found or access denied' });
    }

    // Tear down previous sandbox for this project before creating a new one
    if (project.currentSandboxId) {
        await teardown(project.currentSandboxId);
    }

    const sandboxId = uuid();

    await Promise.all([
        createPod(sandboxId, projectId),
        createService(sandboxId),
        createSandboxKey(sandboxId)
    ]);

    project.currentSandboxId = sandboxId;
    await project.save();

    return res.status(201).json({
        message: 'Sandbox environment created successfully',
        sandboxId,
        previewUrl: `http://${sandboxId}.preview.lvh.me`
    })
})

// Explicit stop — called when the user closes the IDE or navigates away
router.post("/stop", authMiddleware, async (req, res) => {
    const { sandboxId } = req.body;
    if (!sandboxId) return res.status(400).json({ message: 'sandboxId required' });

    await teardown(sandboxId);

    // Clear currentSandboxId on whichever project owns this sandbox
    await Project.updateOne(
        { currentSandboxId: sandboxId, user: req.user.id },
        { $set: { currentSandboxId: null } }
    );

    return res.status(200).json({ message: 'Sandbox stopped' });
})

router.get("/project", authMiddleware, async (req, res) => {
    const projects = await Project.find({ user: req.user.id });

    return res.status(200).json({
        message: 'Projects retrieved successfully',
        projects
    })
})

export default router;
