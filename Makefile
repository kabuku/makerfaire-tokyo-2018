.PHONY: all deploy build clean

all: dist clean build

dist:
	git worktree add gh-pages gh-pages

build:
	npm run lp-build

deploy: all
	cd gh-pages && \
	git add --all && \
	git commit -m "Update pages" && \
	git push origin gh-pages

clean:
	rm -rf gh-pages/*
