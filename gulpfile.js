const config = {
	langs: ['zh', 'en'],
	defaultLang: 'en',
	i18nPath: './i18n/',
	i18nAttrs: ['title', 'class'],
	isProduction: process.env.NODE_ENV === 'production' || (process.argv.indexOf('--prod') > -1)
};

const { src, dest, series, parallel, watch } = require('gulp');
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

const taskCleanUpPreviousBuild = () => src(['./dist', './build'], { read: false, allowEmpty: true }).pipe(clean());
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
taskSass.displayName = 'compile:sass';

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
const GeneratorOfI18nTasks = compileLang => {
	const BuildDir = `./build/${compileLang}`;
	const BuildDirAbsolute = path.resolve(__dirname, BuildDir);
	const BuildTemplateDirAbsolute = path.resolve(BuildDirAbsolute, 'templates');

	const taskI18nCompile = () => src('./templates/**/*.twig')
		.pipe(through.obj(function (file, _, callback) {
			if (file.isBuffer()) {
				const html = file.contents.toString();
				let lang = {};
				try {
					lang = YAML.parse(fs.readFileSync(config.i18nPath + getI18nName(file.basename, compileLang, 'yaml'), 'utf-8'));
				} catch (_) {}
				const $ = cheerio.load(html, { decodeEntities: false }, html.toUpperCase().startsWith('<!DOCTYPE') || html.toLowerCase().startsWith('<html'));
				const i18nElements = $(['[i18n]', '[i18n-key]', ...config.i18nAttrs.map(s => `[i18n-${s}]`)].join(',')).map((_, e) => e).get();
				for(let i in i18nElements) {
					const e = i18nElements[i];
					let val;
					if (compileLang !== config.defaultLang) {
						if (typeof $(e).attr('i18n') === 'string') {
							val = lang[$(e).html().trim()];
							if (val) {
								$(e).html(val);
							}
						} else if ($(e).attr('i18n-key')) {
							val = lang[$(e).attr('i18n-key')];
							if (val) {
								$(e).html(val);
							}
						}
					}
					$(e).removeAttr('i18n').removeAttr('i18n-key');

					config.i18nAttrs.forEach(attr => {
						if (compileLang !== config.defaultLang) {
							const val = $(e).attr(`i18n-${attr}`);
							if (val) {
								$(e).attr(attr, lang[val] || val);
							}
						}
						$(e).removeAttr(`i18n-${attr}`);
					});
				}
				const f = file.clone();
				f.contents = Buffer.from($.html());
				this.push(f);
			}
			return callback();
		}))
		.pipe(dest(BuildDir + '/templates'))
	;
	taskI18nCompile.displayName = 'compile:i18n:' + compileLang;

	const taskTwig = () => src([BuildDir + '/templates/**/*.twig', '!' + BuildDir + '/templates/**/_*.twig'])
		.pipe(gulpTwig({
			base: BuildTemplateDirAbsolute,
			data: {
				_lang: compileLang
			},
			functions: [{
				name: 'url',
				func: args => getI18nName(args, compileLang) // FIXME: this is url
			}, {
				name: 'i18nSwitch',
				func: function (args) {
					return getI18nName(this.context._target.relative, args);
				}
			}]
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
	taskTwig.displayName = 'compile:twig:' + compileLang;
	return series(taskI18nCompile, taskTwig);
};

const taskI18nExtractKeys = () => src('./templates/**/*.twig')
	.pipe(through.obj(function (file, _, callback) {
		if (file.isBuffer()) {
			const $ = cheerio.load(file.contents.toString(), { decodeEntities: false });
			const i18nElements = $(['[i18n]', '[i18n-key]', ...config.i18nAttrs.map(s => `[i18n-${s}]`)].join(',')).map((_, e) => e).get();
			const keys = {};
			for(let i in i18nElements) {
				const e = i18nElements[i];
				if (typeof $(e).attr('i18n') === 'string') {
					keys[$(e).html().trim()] = '';
				} else if ($(e).attr('i18n-key')) {
					keys[$(e).attr('i18n-key')] = '';
				}
				config.i18nAttrs.forEach(attr => {
					if ($(e).attr(`i18n-${attr}`)) {
						keys[$(e).attr(`i18n-${attr}`)] = '';
					}
				});
			}
			config.langs.filter(s => s !== config.defaultLang).forEach(lang => {
				const f = file.clone();
				f.basename = getI18nName(file.basename, lang, 'yaml');
				const newKeys = { ...keys };
				try {
					const old = YAML.parse(fs.readFileSync(config.i18nPath + f.basename, 'utf-8'));
					Object.entries(old).forEach(([k, v]) => newKeys[k] = v);
				} catch (_) {}
				f.contents = Buffer.from(YAML.stringify(newKeys));
				this.push(f);
			});
		}
		return callback();
	}))
	.pipe(dest('./i18n/'))
;

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
exports['i18n:extract'] = taskI18nExtractKeys;

// exports.watch = series(
// 	...TasksDefault,
// 	function taskWatchAll() {
// 		watch('./template/**/*.twig', { events: 'all' }, twig);
// 		watch('./sass/**/*.{sass,scss}', { events: 'all' }, sass);
// 	}
// );
