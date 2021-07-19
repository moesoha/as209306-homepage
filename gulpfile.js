const config = {
	langs: ['zh', 'en'],
	defaultLang: 'en',
	i18nPath: './i18n',
	isProduction: process.env.NODE_ENV === 'production' || (process.argv.indexOf('--prod') > -1)
};

const { src, dest, series, parallel, watch } = require('gulp');
const Vinyl = require('vinyl');
const gulpHtmlMinify = require('gulp-htmlmin');
const gulpFontSpider = require('gulp-font-spider');
const gulpTwig = require('gulp-twig');
const gulpSass = require('gulp-sass')(require('sass'));
const clean = require('gulp-clean');
const cheerio = require('cheerio');
const through = require('through2');
const YAML = require('yaml');
const path = require('path');
const fs = require('fs');

const taskCleanUpPreviousBuild = () => src('./dist', { read: false, allowEmpty: true }).pipe(clean());
taskCleanUpPreviousBuild.displayName = 'clean';

const taskMinifyHtml = () => src('./dist/**/*.html').pipe(gulpHtmlMinify({ collapseWhitespace: true })).pipe(dest('./dist/'));
taskMinifyHtml.displayName = 'minify:html';

const taskCopyPublicFiles = () => src('./public/**').pipe(dest('./dist/'));
taskCopyPublicFiles.displayName = 'copy:public';

const taskCopyFonts = () => src('./fonts/**').pipe(dest('./dist/fonts/'));
taskCopyFonts.displayName = 'copy:fonts';

const taskFontSpider = () => src('./dist/*.html')
	.pipe(gulpFontSpider({
		silent: false,
		backup: false
	}))
	.pipe(dest('./dist/'))
;
taskFontSpider.displayName = 'font-spider';

const taskSass = () => src('./sass/*.{scss,sass}')
	.pipe(gulpSass({
		outputStyle: config.isProduction ? 'compressed' : undefined
	}))
	.pipe(dest('./dist/css/'))
;
taskSass.displayName = 'sass:compile';

const getI18nName = (orig, lang, ext) => {
	const idxDot = orig.lastIndexOf('.');
	let extension = ext;
	if (!extension) {
		extension = orig.substring(idxDot);
	}
	if (!!extension && !extension.startsWith('.')) {
		extension = '.' + extension;
	}
	let langName = '';
	if (config.langs.indexOf(lang) < 0) {
		throw new Error('Unknown language `' + lang + '\'');
	}
	if (lang !== config.defaultLang) {
		langName = '.' + lang;
	}
	const filename = idxDot < 1 ? orig : orig.substring(0, idxDot);
	return filename + langName + extension;
};
const GeneratorOfI18nTasks = (compileLang, extractKey = false) => {
	const I18nStrings = {};
	const I18nGetString = (filename, s) => {
		const key = s.trim();
		const domain = getI18nName(filename, compileLang, 'yaml');

		if (!I18nStrings[domain]) I18nStrings[domain] = {};
		if (!I18nStrings[domain][key]) I18nStrings[domain][key] = '';

		return I18nStrings[domain][key].trim() || key;
	};

	const taskLangFileLoad = () => src(config.i18nPath + '/*.' + compileLang + '.yaml')
		.pipe(through.obj(function (file, _, callback) {
			if (file.isBuffer()) {
				I18nStrings[file.basename] = YAML.parse(file.contents.toString());
			}
			callback();
		}))
	;
	taskLangFileLoad.displayName = 'i18n:load:' + compileLang;

	const taskLangFileSave = () => (() => {
		const src = require('stream').Readable({ objectMode: true });
		src._read = function () {
			for (let [filename, keys] of Object.entries(I18nStrings)) {
				this.push(new Vinyl({
					path: filename,
					contents: Buffer.from(YAML.stringify(keys), 'utf-8')
				}));
			}
			this.push(null);
		};
		return src;
	})().pipe(dest(config.i18nPath));
	taskLangFileSave.displayName = 'i18n:save:' + compileLang;

	const taskTwig = () => src(['./templates/**/*.twig', '!./templates/**/_*.twig'])
		.pipe(gulpTwig({
			base: path.resolve(__dirname, 'templates'),
			data: {
				_lang: compileLang
			},
			functions: [{
				name: 'url',
				func: args => getI18nName(args, compileLang) // FIXME: this is url
			}, {
				name: 'i18nSwitch',
				func (args) { return getI18nName(this.context._target.relative, args); }
			}],
			filters: [{
				name: 'trans',
				func (s) { return I18nGetString(path.basename(this.template.path), s); }
			}],
			extend (Twig) {
				Twig.exports.extendTag({
					type: 'trans',
        			regex: /^trans$/,
					next: ['endtrans'],
					open: true,
					compile (token) {
						delete token.match;
						return token;
					},
					parse (token, context, chain) {
						const text = this.parse(token.output, context).trim();
						return {
							chain,
							output: I18nGetString(path.basename(this.template.path), text)
						}
					}
				});
				Twig.exports.extendTag({
					type: 'endtrans',
					regex: /^endtrans$/,
					next: [],
					open: false
				});
			}
		}))
		.pipe(through.obj(function (file, _, callback) {
			if (file.isBuffer()) {
				if (compileLang !== config.defaultLang) {
					file.basename = getI18nName(file.basename, compileLang);
				}
				this.push(file);
				callback();
			}
		}))
		.pipe(dest('./dist/'))
	;
	taskTwig.displayName = 'twig:compile:' + compileLang;

	const tasks = [taskLangFileLoad, taskTwig];
	if (extractKey) {
		tasks.push(taskLangFileSave);
	}
	return series(...tasks);
};

const TasksDefault = [
	parallel(
		taskCopyFonts,
		taskCopyPublicFiles,
		taskSass,
		...config.langs.map(lang => GeneratorOfI18nTasks(lang))
	),
	taskFontSpider
];
if (config.isProduction) {
	TasksDefault.push(taskMinifyHtml);
}

exports.default = series(...TasksDefault);
exports['clean'] = taskCleanUpPreviousBuild;
exports['i18n:extract'] = parallel(...config.langs
	.filter(s => s !== config.defaultLang)
	.map(lang => GeneratorOfI18nTasks(lang, true))
);

// exports.watch = series(
// 	...TasksDefault,
// 	function taskWatchAll() {
// 		watch('./template/**/*.twig', { events: 'all' }, twig);
// 		watch('./sass/**/*.{sass,scss}', { events: 'all' }, sass);
// 	}
// );
