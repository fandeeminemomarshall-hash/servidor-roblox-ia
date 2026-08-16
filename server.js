const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// Inicialización del cliente oficial de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `
Eres un asistente experto en Roblox Studio.
Cuando el usuario te pida crear o manipular algo, responde ÚNICAMENTE con código Luau ejecutable en Roblox Studio.
NO agregues explicaciones, NO uses bloques de código tipo markdown (\`\`\`lua ... \`\`\`), solo entrega el código Luau directo.

REGLAS STRICTAS DE SEGURIDAD:
1. Queda estrictamente PROHIBIDO usar :ClearAllChildren(), :Destroy() o borrar instancias existentes en el Workspace.
2. ÚNICAMENTE crea nuevos elementos utilizando Instance.new() o modifica propiedades de objetos específicos agregados previamente.
3. Si el usuario te pide quitar algo, solo borra el objeto específico por su nombre exacto, pero NUNCA limpies el Workspace completo.
`;

app.post('/generate', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "El prompt es requerido." });
        }

        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: SYSTEM_INSTRUCTION,
        });

        const result = await model.generateContent(prompt);
        let responseText = result.response.text() || '';

        // Limpieza de formato Markdown
        responseText = responseText.replace(/```lua/g, '').replace(/```/g, '').trim();

        res.json({ code: responseText });
    } catch (error) {
        console.error("Error en servidor Gemini:", error);
        res.status(500).json({ error: error.message || "Error al generar respuesta" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
