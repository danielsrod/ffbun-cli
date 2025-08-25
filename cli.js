#!/usr/bin/env node

const simpleGit = require('simple-git');
const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { execSync } = require("node:child_process");
const inquirer = require("inquirer");

const repoUrl = "https://github.com/danielsrod/ffbun";

function execCommand(command) {
	try {
	  console.log(`Executing command: ${command}`);
	  const result = execSync(command, { stdio: 'inherit' });
	  return result;
	} catch (error) {
	  console.error("Error executing command:", error.message);
	  process.exit(1);
	}
}

function toPascalCase(str) {
    return str.replace(/(^|\s)(\w)/g, (match, p1, p2) => p2.toUpperCase());
}

function toCamelCase(str) {
    return str.replace(/(^|\s)(\w)/g, (match, p1, p2, offset) => offset === 0 ? p2.toLowerCase() : p2.toUpperCase());
}

function formatModuleName(rawName) {
    const moduleName = toPascalCase(rawName);
    const instanceName = toCamelCase(rawName);
    const interfaceName = `I${moduleName}`;
    return { moduleName, instanceName, interfaceName };
}

async function generateTemplate() {
	try {
		const git = simpleGit();
		await git.checkIsRepo();
		const targetDir = process.argv[3] || ".";
		const projectName = targetDir.split("/").pop();

		if (fs.existsSync(targetDir)) {
			console.error("Directory already exists");
			return;
		}

		const prompt = inquirer.createPromptModule();
		const answers = await prompt([
			{
			type: "list",
			name: "branch",
			message: "Which database you need? main for no database implemented.",
			choices: ["main", "oracle"],
			},
		]);

		
		const selectedBranch = answers.branch;
		const fullCommand = selectedBranch === "main" ? `git clone ${repoUrl}` : `git clone -b ${selectedBranch} ${repoUrl}`;
		execCommand(fullCommand);
		if (process.platform === 'win32') {
			execCommand(`rename ffbun ${projectName}`);
			execCommand(`rmdir /s /q ${projectName}\\.git`);
		  } else {
			execCommand(`mv ffbun ${projectName}`);
			execCommand(`rm -rf ${projectName}/.git`);
		}

		console.log(`Creating project ${projectName}...`);

	} catch (error) {
		console.log(error);
	}
}

async function updateRoutesFile(moduleName) {
    try {
        const routesFilePath = path.join("src", "router.ts");
        const routeImport = `import { ${moduleName}Routes } from "./modules/${moduleName}/routes";\n`;
        const registerRoute = `    fastify.register(${moduleName}Routes);\n`;

        let fileContent = fs.readFileSync(routesFilePath, "utf8");

        if (!fileContent.includes(routeImport)) {
            const importEndIndex = fileContent.lastIndexOf("import ");
            const nextLineIndex = fileContent.indexOf("\n", importEndIndex) + 1;
            fileContent = fileContent.slice(0, nextLineIndex) + routeImport + fileContent.slice(nextLineIndex);
        }

        const registerIndex = fileContent.indexOf("export const router");
        const insertPosition = fileContent.indexOf("}", registerIndex);
        fileContent = fileContent.slice(0, insertPosition) + registerRoute + fileContent.slice(insertPosition);

        fs.writeFileSync(routesFilePath, fileContent);
        console.log(`Routes updated for module: ${moduleName}`);
    } catch (error) {
        console.error("Error updating routes file:", error.message);
    }
}

function generateModule(rawName) {
    try {
        const { moduleName, instanceName, interfaceName } = formatModuleName(rawName);
        const modulePath = path.join("src", "modules", moduleName);
        if (fs.existsSync(modulePath)) {
            console.error(`Module ${moduleName} already exists`);
            return;
        }

        fs.mkdirSync(modulePath, { recursive: true });

        const files = {
            schema: `import { z } from "zod";

export const ${instanceName} = z.object({
    foo: z.string(),
    bar: z.string()
});
`,
            interfaces: `import type z from "zod";
import type * as schema from "./schema";

export interface ${interfaceName} {
    BAR: string;
}

export interface ${interfaceName}FromZod extends z.infer<(typeof schema)["${instanceName}"]> {}
`,
            controller: `import type { ICatchError } from '../../utils/interfaces';
import * as repository from './repository';

export const ${instanceName} = async (params: object, query: object, body: object) => {
    try {
        const result = await repository.${instanceName}();
        return result;
    } catch (error) {
        const { message } = error as ICatchError;
        throw new Error(message);
    }
};
`,
            repository: `import type { ICatchError } from "../../utils/interfaces";
import type * as interfaces from "./interfaces";

export const ${instanceName} = async () => {
    try {
        const obj: interfaces.${interfaceName} = {
            BAR: '${moduleName}'
        };
        return obj;
    } catch (error) {
        const { stack } = error as ICatchError;
        console.error(stack);
        throw new Error(stack);
    }
};
`,
            routes: `import type { FastifyInstance } from 'fastify';
import * as controller from './controller';
import * as schema from './schema';

export const ${moduleName}Routes = async (fastify: FastifyInstance) => {
    fastify.post('/${instanceName}/:foo/:bar', {
        schema: {
            querystring: schema.${instanceName},
            body: schema.${instanceName},
            params: schema.${instanceName}
        },
    }, async (request, replay) => {
        try {
            const result = await controller.${instanceName}(request.params, request.query, request.body);
            return replay.send({ status: true, message: '${moduleName}', data: result });
        } catch (error) {
            return replay.send({ status: false, message: error.message, data: null });
        }
    });
};
`
        };

        for (const [key, content] of Object.entries(files)) {
            const filePath = path.join(modulePath, `${key}.ts`);
            fs.writeFileSync(filePath, content);
        }

        updateRoutesFile(moduleName);
        console.log(`Module ${moduleName} created successfully`);
    } catch (error) {
        console.error("Error generating module:", error.message);
    }
}

const command = process.argv[2];
if (command === "newmodule") {
	const moduleName = process.argv[3];
	generateModule(moduleName);
} else if (command === "init") {
	generateTemplate();
} else {
	console.log(
		'Unknown command. Use "init" to create a project or "newmodule <ModuleName>" to generate a new module.',
	);
}
