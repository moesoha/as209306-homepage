const { TaskGenerate } = require('gulp-task-static-pages');

Object.assign(exports, TaskGenerate({ 
	isProduction: process.env.NODE_ENV === 'production' || (process.argv.indexOf('--prod') > -1)
 }));
