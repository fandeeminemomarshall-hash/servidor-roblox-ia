const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "TU_API_KEY_AQUI");

const SYSTEM_INSTRUCTION = `
Eres un asistente experto en Roblox Studio.
Cuando el usuario te pida crear o generar algo, responde ÚNICAMENTE con código Luau ejecutable en Roblox Studio.
NO agregues explicaciones, NO uses bloques de código tipo markdown (\`\`\`lua ... \`\`\`), solo entrega el código Luau directo.
El código debe crear los elementos en el Workspace usando Instance.new o manipular propiedades.
`;

app.post('/generate', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        // Uso del modelo gemini-2.0-flash compatible
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            systemInstruction: SYSTEM_INSTRUCTION
        });

        const result = await model.generateContent(prompt);
        let responseText = result.response.text();

        // Limpieza de bloques markdown
        responseText = responseText.replace(/```lua/g, '').replace(/```/g, '').trim();

        res.json({ code: responseText });
    } catch (error) {
        console.error("Error en Gemini:", error);
        res.status(500).json({ error: "Error al generar respuesta" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
