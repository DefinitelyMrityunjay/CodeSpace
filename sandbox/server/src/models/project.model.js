import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    title: {
        type: String,
        default: "Untitled Project"
    },
    currentSandboxId: {
        type: String,
        default: null
    }
});

const Project = mongoose.model('project', projectSchema);

export default Project;