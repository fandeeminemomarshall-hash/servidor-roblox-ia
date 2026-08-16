const express = require('express');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

// Inicialización del nuevo SDK de Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `
Eres un asistente experto en Roblox Studio.
Cuando el usuario te pida crear o generar algo, responde ÚNICAMENTE con código Luau ejecutable en Roblox Studio.
NO agregues explicaciones, NO uses bloques de código tipo markdown (\`\`\`lua ... \`\`\`), solo entrega el código Luau directo.
El código debe crear los elementos en el Workspace usando Instance.new o manipular propiedades.
`;

app.post('/generate', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        // Llamada a la nueva API
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: SYSTEM_INSTRUCTION,
            }
        });

        let responseText = response.text;

        // Limpieza de formato Markdown
        responseText = responseText.replace(/```lua/g, '').replace(/```/g, '').trim();

        res.json({ code: responseText });
    } catch (error) {
        console.error("Error en servidor Gemini:", error);
        res.status(500).json({ error: "Error al generar respuesta" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
